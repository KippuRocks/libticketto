// T-008-04: setEventStatus, with transitions (features/008-ledger-rules/plan.md
// §5.2; SPEC.md US-A4, US-A5, REQ-EV-11, REQ-EV-12).

import type {
  AccountId,
  ClassId,
  EventStatus,
  IssueTicket,
  Result,
  SetEventStatus,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  createEventCommand,
  envelope,
  id32,
  profile,
  registered,
  sign,
  type TestCredential,
} from "../../test/fixtures.js";
import type { EventRecord } from "../capabilities.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const STATUSES: readonly EventStatus[] = ["Active", "Sealed", "Cancelled", "Finished"];
const PERMITTED: readonly (readonly [EventStatus, EventStatus])[] = [
  ["Active", "Sealed"],
  ["Active", "Finished"],
  ["Active", "Cancelled"],
  ["Sealed", "Finished"],
  ["Sealed", "Cancelled"],
];

interface Fixture {
  readonly caps: FakeCapabilities;
  readonly organiser: TestCredential;
  readonly event: EventRecord;
  readonly zone: ZoneId;
  setStatus(status: EventStatus, signer?: TestCredential): Promise<Result<unknown>>;
  status(): Promise<EventStatus | undefined>;
}

async function fixture(status: EventStatus = "Active"): Promise<Fixture> {
  const caps = createFakeCapabilities();
  const organiser = await registered(caps);
  const zone = id32<ZoneId>();
  const create = createEventCommand(organiser.account, { zones: [{ id: zone, kind: "Unseated" }] });
  if (!(await execute(caps, profile, await sign(organiser, create))).ok) throw new Error("fixture");
  const created = (await caps.registry.getEvent(create.event)) as EventRecord;
  await caps.registry.putEvent({ ...created, status });
  const event = (await caps.registry.getEvent(create.event)) as EventRecord;
  return {
    caps,
    organiser,
    event,
    zone,
    setStatus: async (to, signer = organiser) => {
      const command: SetEventStatus = {
        ...envelope(caps.clock.now() + 60_000),
        kind: "setEventStatus",
        event: event.id,
        status: to,
      };
      return execute(caps, profile, await sign(signer, command));
    },
    status: async () => (await caps.registry.getEvent(event.id))?.status,
  };
}

describe("setEventStatus (REQ-EV-11)", () => {
  it("AC-A4.1: sealing an Active event makes it Sealed, and issuance then fails with ERR-EventSealed", async () => {
    const f = await fixture("Active");
    expect((await f.setStatus("Sealed")).ok).toBe(true);
    expect(await f.status()).toBe("Sealed");

    const placement = { kind: "Unseated" as const, discriminator: "1".repeat(32) as never };
    const issue: IssueTicket = {
      ...envelope(),
      kind: "issueTicket",
      event: f.event.id,
      ticket: profile.ticketId(f.event.id, f.zone, placement),
      zone: f.zone,
      placement,
      class: "01" as ClassId,
      provenance: "Purchased",
      policy: { kind: "Single" },
      restrictions: { cannotResale: false, cannotTransfer: false },
      holder: id32<AccountId>(),
      metadata: null,
    };
    expect(codeOf(await execute(f.caps, profile, await sign(f.organiser, issue)))).toBe(
      "ERR-EventSealed",
    );
  });

  it.each(["Active", "Sealed"] as const)(
    "AC-A5.1: cancelling a %s event makes it Cancelled",
    async (from) => {
      const f = await fixture(from);
      expect((await f.setStatus("Cancelled")).ok).toBe(true);
      expect(await f.status()).toBe("Cancelled");
    },
  );

  it.each(PERMITTED)("REQ-EV-11: %s → %s is permitted", async (from, to) => {
    const f = await fixture(from);
    expect((await f.setStatus(to)).ok).toBe(true);
    expect(await f.status()).toBe(to);
    expect(f.caps.log().at(-1)?.event?.id).toBe(f.event.id);
  });

  const forbidden = STATUSES.flatMap((from) =>
    STATUSES.filter((to) => !PERMITTED.some(([a, b]) => a === from && b === to)).map(
      (to) => [from, to] as const,
    ),
  ).filter(([from]) => from !== "Finished");

  it.each(forbidden)(
    "AC-A5.8: %s → %s fails with ERR-InvalidTransition, changing nothing",
    async (from, to) => {
      const f = await fixture(from);
      const logBefore = f.caps.log().length;
      expect(codeOf(await f.setStatus(to))).toBe("ERR-InvalidTransition");
      expect(await f.status()).toBe(from);
      expect(f.caps.log()).toHaveLength(logBefore);
    },
  );

  it.each(STATUSES)("AC-A5.6: Cancelled is terminal — Cancelled → %s fails", async (to) => {
    const f = await fixture("Cancelled");
    expect(codeOf(await f.setStatus(to))).toBe("ERR-InvalidTransition");
    expect(await f.status()).toBe("Cancelled");
  });

  it.each(STATUSES)(
    "AC-A5.6: Finished is terminal — Finished → %s fails with ERR-EventFinished (INV-16)",
    async (to) => {
      const f = await fixture("Finished");
      expect(codeOf(await f.setStatus(to))).toBe("ERR-EventFinished");
      expect(await f.status()).toBe("Finished");
    },
  );

  it("REQ-EV-12: the organiser sets Finished; the ledger's clock does not", async () => {
    const f = await fixture("Active");
    f.caps.clock.advance(365 * 24 * 60 * 60 * 1000);
    expect(await f.status()).toBe("Active");
    expect((await f.setStatus("Finished")).ok).toBe(true);
    expect(await f.status()).toBe("Finished");
  });

  it("ERR-NotOwner: a signer who does not own the event", async () => {
    const f = await fixture("Active");
    const stranger = await registered(f.caps);
    expect(codeOf(await f.setStatus("Sealed", stranger))).toBe("ERR-NotOwner");
    expect(await f.status()).toBe("Active");
  });

  it("check order: ownership before the transition", async () => {
    const f = await fixture("Cancelled");
    const stranger = await registered(f.caps);
    expect(codeOf(await f.setStatus("Active", stranger))).toBe("ERR-NotOwner");
  });
});
