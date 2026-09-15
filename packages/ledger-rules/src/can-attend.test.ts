// T-008-09: canAttend and getCancellationHolder (features/008-ledger-rules/plan.md
// §5.3, §5.5; SPEC.md REQ-Q-1–REQ-Q-4, US-E2, REQ-EV-10).

import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Discriminator,
  EventId,
  EventStatus,
  Query,
  Result,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../test/fake-capabilities.js";
import { eventId, id32, profile } from "../test/fixtures.js";
import type { Capabilities, Registry, TicketRecord } from "./capabilities.js";
import { query } from "./query.js";

const HOLDER = id32<AccountId>();

interface Setup {
  readonly caps: FakeCapabilities;
  readonly event: EventId;
  readonly ticket: TicketId;
}

async function setup(
  options: {
    readonly status?: EventStatus;
    readonly policy?: AttendancePolicy;
    readonly attendances?: number;
    readonly cancellationHolder?: AccountId;
    readonly now?: number;
  } = {},
): Promise<Setup> {
  const caps = createFakeCapabilities();
  if (options.now !== undefined) caps.clock.set(options.now);
  const event = eventId();
  const zone = id32<ZoneId>();
  await caps.registry.putEvent({
    id: event,
    owner: id32<AccountId>(),
    status: options.status ?? "Active",
    maxCapacity: null,
    issued: 1,
    zones: [{ id: zone, kind: "Unseated" }],
    zonesInUse: [zone],
  });
  const ticket = id32<TicketId>();
  await caps.registry.insertTicket({
    id: ticket,
    event,
    holder: HOLDER,
    class: "01" as ClassId,
    provenance: "Purchased",
    zone,
    placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
    policy: options.policy ?? { kind: "Single" },
    restrictions: { cannotResale: false, cannotTransfer: false },
    attendances: options.attendances ?? 0,
  });
  if (options.cancellationHolder !== undefined) {
    await caps.registry.recordTicketFacts(ticket, {
      cancellationHolder: options.cancellationHolder,
    });
  }
  return { caps, event, ticket };
}

const canAttend = ({ caps, event, ticket }: Setup) =>
  query(caps, profile, { kind: "canAttend", event, ticket });

function verdict(result: Result<unknown>) {
  if (!result.ok) throw new Error(`query failed: ${result.error.code}`);
  return result.value;
}

const refused = (reason: string) => ({ admit: false, reason });

/** Capabilities whose every write, and every transaction, throws. */
function readOnly(caps: Capabilities): Capabilities {
  const writes: (keyof Registry)[] = [
    "putEvent",
    "addRegistration",
    "insertTicket",
    "setHolder",
    "recordTicketFacts",
    "recordConsumedPass",
    "recordOperation",
    "appendLog",
  ];
  const registry = { ...caps.registry };
  for (const method of writes) {
    (registry as Record<string, unknown>)[method] = () => {
      throw new Error(`a query called ${method}`);
    };
  }
  return {
    registry,
    clock: caps.clock,
    transaction: () => {
      throw new Error("a query opened a transaction");
    },
  };
}

describe("canAttend (REQ-Q-1–REQ-Q-4)", () => {
  it("AC-E2.1: a ticket that would admit is admitted", async () => {
    expect(verdict(await canAttend(await setup()))).toEqual({ admit: true });
  });

  it("AC-A4.2: a ticket of a Sealed event still admits", async () => {
    expect(verdict(await canAttend(await setup({ status: "Sealed" })))).toEqual({ admit: true });
  });

  it("AC-E2.1: a refusal says why — a Cancelled event", async () => {
    expect(verdict(await canAttend(await setup({ status: "Cancelled" })))).toEqual(
      refused("ERR-EventCancelled"),
    );
  });

  it("AC-E2.1: a refusal says why — a Finished event", async () => {
    expect(verdict(await canAttend(await setup({ status: "Finished" })))).toEqual(
      refused("ERR-EventFinished"),
    );
  });

  it("AC-E2.1: a refusal says why — an expired policy", async () => {
    const s = await setup({ policy: { kind: "Unlimited", until: 1_000 }, now: 1_001 });
    expect(verdict(await canAttend(s))).toEqual(refused("ERR-TicketExpired"));
  });

  it("AC-E2.1: a refusal says why — an exhausted allowance", async () => {
    const s = await setup({ policy: { kind: "Multiple", max: 3, until: null }, attendances: 3 });
    expect(verdict(await canAttend(s))).toEqual(refused("ERR-CannotAttend"));
  });

  it("a Single ticket admits once", async () => {
    expect(verdict(await canAttend(await setup({ attendances: 0 })))).toEqual({ admit: true });
    expect(verdict(await canAttend(await setup({ attendances: 1 })))).toEqual(
      refused("ERR-CannotAttend"),
    );
  });

  it("a Multiple ticket admits up to max times", async () => {
    const policy: AttendancePolicy = { kind: "Multiple", max: 2, until: null };
    expect(verdict(await canAttend(await setup({ policy, attendances: 1 })))).toEqual({
      admit: true,
    });
    expect(verdict(await canAttend(await setup({ policy, attendances: 2 })))).toEqual(
      refused("ERR-CannotAttend"),
    );
  });

  it("an Unlimited ticket admits any number of times, at or before its until", async () => {
    const policy: AttendancePolicy = { kind: "Unlimited", until: 5_000 };
    expect(
      verdict(await canAttend(await setup({ policy, attendances: 10_000, now: 5_000 }))),
    ).toEqual({ admit: true });
    expect(verdict(await canAttend(await setup({ policy, now: 5_001 })))).toEqual(
      refused("ERR-TicketExpired"),
    );
  });

  it("judges policy expiry at the authority's clock", async () => {
    const s = await setup({ policy: { kind: "Multiple", max: 5, until: 2_000 }, now: 2_000 });
    expect(verdict(await canAttend(s))).toEqual({ admit: true });
    s.caps.clock.advance(1);
    expect(verdict(await canAttend(s))).toEqual(refused("ERR-TicketExpired"));
  });

  it.each<[string, AttendancePolicy | undefined]>([
    ["an unknown kind", { kind: "Sometimes" } as never],
    ["a Multiple without max", { kind: "Multiple", until: null } as never],
    ["an until that is not a time", { kind: "Unlimited", until: "later" } as never],
    ["no policy at all", null as never],
  ])(
    "REQ-Q-4: %s gives ERR-PolicyUndeterminable, never a permissive default",
    async (_, policy) => {
      const s = await setup();
      const stored = (await s.caps.registry.getTicket(s.ticket)) as TicketRecord;
      // Written behind the rules' back: a record no V0 command could produce.
      const broken = id32<TicketId>();
      await s.caps.registry.insertTicket({
        ...stored,
        id: broken,
        policy: policy as AttendancePolicy,
      });
      expect(verdict(await canAttend({ ...s, ticket: broken }))).toEqual(
        refused("ERR-PolicyUndeterminable"),
      );
    },
  );

  describe("REQ-Q-2: order", () => {
    const exhaustedAndExpired: AttendancePolicy = { kind: "Multiple", max: 1, until: 10 };

    it("Cancelled before policy expiry and allowance", async () => {
      const s = await setup({
        status: "Cancelled",
        policy: exhaustedAndExpired,
        attendances: 1,
        now: 11,
      });
      expect(verdict(await canAttend(s))).toEqual(refused("ERR-EventCancelled"));
    });

    it("Finished before policy expiry and allowance", async () => {
      const s = await setup({
        status: "Finished",
        policy: exhaustedAndExpired,
        attendances: 1,
        now: 11,
      });
      expect(verdict(await canAttend(s))).toEqual(refused("ERR-EventFinished"));
    });

    it("status before an undeterminable policy", async () => {
      const s = await setup({ status: "Cancelled", policy: { kind: "Nope" } as never });
      expect(verdict(await canAttend(s))).toEqual(refused("ERR-EventCancelled"));
    });

    it("policy expiry before allowance", async () => {
      const s = await setup({ policy: exhaustedAndExpired, attendances: 1, now: 11 });
      expect(verdict(await canAttend(s))).toEqual(refused("ERR-TicketExpired"));
    });
  });

  it("AC-E2.2: performs no write and opens no transaction, admitted or refused", async () => {
    for (const options of [{}, { status: "Cancelled" as const }, { attendances: 1 }]) {
      const s = await setup(options);
      const caps = readOnly(s.caps);
      const logBefore = s.caps.log().length;
      const ticketBefore = await s.caps.registry.getTicket(s.ticket);
      const result = await query(caps, profile, {
        kind: "canAttend",
        event: s.event,
        ticket: s.ticket,
      });
      expect(result.ok).toBe(true);
      expect(s.caps.log()).toHaveLength(logBefore);
      expect(await s.caps.registry.getTicket(s.ticket)).toEqual(ticketBefore);
    }
  });
});

describe("getCancellationHolder (REQ-EV-10, plan §5.5)", () => {
  const holderOf = ({ caps, ticket }: Setup) =>
    query(caps, profile, { kind: "getCancellationHolder", ticket } satisfies Query);

  it("REQ-EV-10: is null while the event is not Cancelled", async () => {
    for (const status of ["Active", "Sealed", "Finished"] as const) {
      expect(await holderOf(await setup({ status }))).toEqual({ ok: true, value: null });
    }
  });

  it("REQ-EV-10: is the current holder of a cancelled event's ticket that has not changed hands", async () => {
    expect(await holderOf(await setup({ status: "Cancelled" }))).toEqual({
      ok: true,
      value: HOLDER,
    });
  });

  it("REQ-EV-10: is the snapshot once the ticket has changed hands after cancellation", async () => {
    const snapshot = id32<AccountId>();
    const s = await setup({ status: "Cancelled", cancellationHolder: snapshot });
    await s.caps.registry.setHolder(s.ticket, id32<AccountId>());
    expect(await holderOf(s)).toEqual({ ok: true, value: snapshot });
  });

  it("REQ-Q-1: performs no write", async () => {
    const s = await setup({ status: "Cancelled" });
    const result = await query(readOnly(s.caps), profile, {
      kind: "getCancellationHolder",
      ticket: s.ticket,
    });
    expect(result).toEqual({ ok: true, value: HOLDER });
  });
});
