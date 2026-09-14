// T-008-06: addZone and removeZone (features/008-ledger-rules/plan.md §5.2,
// §5.7a; SPEC.md REQ-ID-7).

import type { EventId, EventStatus, Result, Zone, ZoneId } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  envelope,
  eventId,
  profile,
  registered,
  sign,
  type TestCredential,
  zoneId,
} from "../../test/fixtures.js";
import type { EventRecord } from "../capabilities.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const seatedZone: Zone = { id: zoneId(), kind: "Seated" };
const unseatedZone: Zone = { id: zoneId(), kind: "Unseated" };

async function withEvent(
  status: EventStatus = "Active",
  zonesInUse: readonly ZoneId[] = [],
): Promise<{ caps: FakeCapabilities; organiser: TestCredential; record: EventRecord }> {
  const caps = createFakeCapabilities();
  const organiser = await registered(caps);
  const record: EventRecord = {
    id: eventId(),
    owner: organiser.account,
    status,
    maxCapacity: null,
    issued: zonesInUse.length,
    zones: [seatedZone, unseatedZone],
    zonesInUse,
  };
  await caps.registry.putEvent(record);
  return { caps, organiser, record };
}

const addZone = (event: EventId, zone: Zone) => ({
  ...envelope(),
  kind: "addZone" as const,
  event,
  zone,
});
const removeZone = (event: EventId, zone: ZoneId) => ({
  ...envelope(),
  kind: "removeZone" as const,
  event,
  zone,
});

describe("addZone", () => {
  it("REQ-ID-7: adds a zone, with its kind, to an Active event", async () => {
    const { caps, organiser, record } = await withEvent();
    const zone: Zone = { id: zoneId(), kind: "Unseated" };

    expect((await execute(caps, profile, await sign(organiser, addZone(record.id, zone)))).ok).toBe(
      true,
    );
    expect(await caps.registry.getEvent(record.id)).toEqual({
      ...record,
      zones: [seatedZone, unseatedZone, zone],
    });
    expect(caps.log()).toHaveLength(1);
  });

  it("ERR-EventSealed: adding a zone while the event is Sealed", async () => {
    const { caps, organiser, record } = await withEvent("Sealed");
    const signed = await sign(organiser, addZone(record.id, { id: zoneId(), kind: "Seated" }));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventSealed");
    expect(await caps.registry.getEvent(record.id)).toEqual(record);
  });

  it("ERR-EventCancelled: adding a zone while the event is Cancelled", async () => {
    const { caps, organiser, record } = await withEvent("Cancelled");
    const signed = await sign(organiser, addZone(record.id, { id: zoneId(), kind: "Seated" }));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventCancelled");
    expect(await caps.registry.getEvent(record.id)).toEqual(record);
  });

  it("ERR-EventFinished: adding a zone while the event is Finished", async () => {
    const { caps, organiser, record } = await withEvent("Finished");
    const signed = await sign(organiser, addZone(record.id, { id: zoneId(), kind: "Seated" }));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventFinished");
  });

  it("ERR-ZoneExists: adding a zone whose id the event already has, whatever its kind", async () => {
    const { caps, organiser, record } = await withEvent();
    const signed = await sign(
      organiser,
      addZone(record.id, { id: seatedZone.id, kind: "Unseated" }),
    );
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-ZoneExists");
    expect(await caps.registry.getEvent(record.id)).toEqual(record);
  });

  it("ERR-NotOwner: a signer who does not own the event", async () => {
    const { caps, record } = await withEvent();
    const stranger = await registered(caps);
    const signed = await sign(stranger, addZone(record.id, { id: zoneId(), kind: "Seated" }));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-NotOwner");
  });

  describe("check order (plan §5.2)", () => {
    it("ownership before status", async () => {
      const { caps, record } = await withEvent("Sealed");
      const stranger = await registered(caps);
      const signed = await sign(stranger, addZone(record.id, { id: zoneId(), kind: "Seated" }));
      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-NotOwner");
    });

    it("status before a duplicate zone id", async () => {
      const { caps, organiser, record } = await withEvent("Cancelled");
      const signed = await sign(organiser, addZone(record.id, seatedZone));
      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventCancelled");
    });
  });
});

describe("removeZone", () => {
  it("REQ-ID-7: removes a zone in which no ticket has been issued", async () => {
    const { caps, organiser, record } = await withEvent("Active", [seatedZone.id]);
    const signed = await sign(organiser, removeZone(record.id, unseatedZone.id));

    expect((await execute(caps, profile, signed)).ok).toBe(true);
    expect(await caps.registry.getEvent(record.id)).toEqual({ ...record, zones: [seatedZone] });
  });

  it("ERR-UnknownZone: removing a zone the event does not define", async () => {
    const { caps, organiser, record } = await withEvent();
    const signed = await sign(organiser, removeZone(record.id, zoneId()));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-UnknownZone");
    expect(await caps.registry.getEvent(record.id)).toEqual(record);
  });

  it("ERR-ZoneInUse: removing a zone in which a ticket has been issued", async () => {
    const { caps, organiser, record } = await withEvent("Active", [seatedZone.id]);
    const signed = await sign(organiser, removeZone(record.id, seatedZone.id));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-ZoneInUse");
    expect(await caps.registry.getEvent(record.id)).toEqual(record);
    expect(caps.log()).toHaveLength(0);
  });

  it("ERR-NotOwner: a signer who does not own the event", async () => {
    const { caps, record } = await withEvent();
    const stranger = await registered(caps);
    const signed = await sign(stranger, removeZone(record.id, unseatedZone.id));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-NotOwner");
  });

  describe("check order (plan §5.2)", () => {
    it("ownership before the zone's existence", async () => {
      const { caps, record } = await withEvent();
      const stranger = await registered(caps);
      const signed = await sign(stranger, removeZone(record.id, zoneId()));
      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-NotOwner");
    });
  });
});
