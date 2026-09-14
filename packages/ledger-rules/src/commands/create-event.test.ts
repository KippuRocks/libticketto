// T-008-03: createEvent (features/008-ledger-rules/plan.md §5.2; SPEC.md US-A1,
// REQ-EV-3, REQ-EV-9, REQ-ID-7).

import type { Event, Receipt, Result, Zone } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities } from "../../test/fake-capabilities.js";
import { createEventCommand, profile, registered, sign, zoneId } from "../../test/fixtures.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const seated = (): Zone => ({ id: zoneId(), kind: "Seated" });
const unseated = (): Zone => ({ id: zoneId(), kind: "Unseated" });

describe("createEvent", () => {
  it("AC-A1.1: creates an Active event owned by the organiser", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const zones = [seated(), unseated()];
    const command = createEventCommand(organiser.account, { zones, capacity: 500 });

    const result = await execute(caps, profile, await sign(organiser, command));

    expect(result.ok).toBe(true);
    expect(await caps.registry.getEvent(command.event)).toEqual<Event>({
      id: command.event,
      owner: organiser.account,
      status: "Active",
      maxCapacity: 500,
      issued: 0,
      zones,
    });
  });

  it("AC-A1.2: with no capacity, the event's issuance is unbounded", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const command = createEventCommand(organiser.account, { capacity: null });

    expect((await execute(caps, profile, await sign(organiser, command))).ok).toBe(true);
    expect((await caps.registry.getEvent(command.event))?.maxCapacity).toBeNull();
  });

  it("REQ-EV-9: records the event under the id the profile derives, in its own log sequence", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const command = createEventCommand(organiser.account);
    const signed = await sign(organiser, command);

    const result = (await execute(caps, profile, signed)) as { ok: true; value: Receipt };
    expect(caps.log()).toEqual([
      {
        cursor: result.value.cursor,
        recordedAt: 0,
        event: { id: command.event, sequence: 1 },
        entry: signed,
        presentedAt: null,
      },
    ]);
  });

  it("ERR-IdentifierMismatch: an event id not derived from the signer and salt is rejected", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const command = {
      ...createEventCommand(organiser.account),
      salt: new Uint8Array([9]),
    };
    expect(codeOf(await execute(caps, profile, await sign(organiser, command)))).toBe(
      "ERR-IdentifierMismatch",
    );
    expect(caps.log()).toHaveLength(0);
  });

  it("ERR-IdentifierMismatch: another account's derivation is not the signer's", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const other = await registered(caps);
    const command = createEventCommand(other.account);
    expect(codeOf(await execute(caps, profile, await sign(organiser, command)))).toBe(
      "ERR-IdentifierMismatch",
    );
  });

  it("ERR-EventIdExists: a second creation deriving the same id is rejected, changing nothing", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const first = createEventCommand(organiser.account, { capacity: 10 });
    await execute(caps, profile, await sign(organiser, first));

    const again = createEventCommand(organiser.account, { capacity: 99 });
    expect(again.event).toBe(first.event);
    expect(codeOf(await execute(caps, profile, await sign(organiser, again)))).toBe(
      "ERR-EventIdExists",
    );
    expect((await caps.registry.getEvent(first.event))?.maxCapacity).toBe(10);
    expect(caps.log()).toHaveLength(1);
  });

  it("REQ-CM-1: an identical replay of a creation returns the original receipt", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const signed = await sign(organiser, createEventCommand(organiser.account));
    const first = await execute(caps, profile, signed);
    expect(await execute(caps, profile, signed)).toEqual(first);
    expect(caps.log()).toHaveLength(1);
  });

  it("ERR-ZoneExists: an event naming the same zone id twice is rejected", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const zone = seated();
    const command = createEventCommand(organiser.account, {
      zones: [zone, unseated(), { id: zone.id, kind: "Unseated" }],
    });
    expect(codeOf(await execute(caps, profile, await sign(organiser, command)))).toBe(
      "ERR-ZoneExists",
    );
    expect(await caps.registry.getEvent(command.event)).toBeNull();
  });

  describe("check order (plan §5.2)", () => {
    it("the identifier is checked before existence", async () => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      const first = createEventCommand(organiser.account);
      await execute(caps, profile, await sign(organiser, first));
      // Names the existing event, but with a salt that does not derive it.
      const mismatched = { ...createEventCommand(organiser.account), salt: new Uint8Array([1]) };
      expect(mismatched.event).toBe(first.event);
      expect(codeOf(await execute(caps, profile, await sign(organiser, mismatched)))).toBe(
        "ERR-IdentifierMismatch",
      );
    });

    it("existence is checked before duplicate zones", async () => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      await execute(caps, profile, await sign(organiser, createEventCommand(organiser.account)));
      const zone = seated();
      const again = createEventCommand(organiser.account, { zones: [zone, zone] });
      expect(codeOf(await execute(caps, profile, await sign(organiser, again)))).toBe(
        "ERR-EventIdExists",
      );
    });
  });
});
