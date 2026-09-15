// T-008-08: transferTicket, with the lazy cancellation snapshot
// (features/008-ledger-rules/plan.md §5.2, §5.5; SPEC.md US-D1, INV-2, REQ-TK-4,
// REQ-EV-10, AC-A5.4).

import type {
  AccountId,
  ClassId,
  Discriminator,
  EventId,
  EventStatus,
  Provenance,
  Result,
  TicketId,
  TicketRestrictions,
  TransferTicket,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  envelope,
  id32,
  profile,
  registered,
  sign,
  type TestCredential,
} from "../../test/fixtures.js";
import { execute } from "../execute.js";
import { query } from "../query.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const NONE: TicketRestrictions = { cannotResale: false, cannotTransfer: false };

interface Fixture {
  readonly caps: FakeCapabilities;
  readonly holder: TestCredential;
  readonly event: EventId;
  readonly ticket: TicketId;
  transfer(from: TestCredential, to: AccountId, ticket?: TicketId): Promise<Result<unknown>>;
  setStatus(status: EventStatus): Promise<void>;
  holderOf(): Promise<AccountId | undefined>;
  cancellationHolder(): Promise<unknown>;
}

async function fixture(
  options: {
    readonly status?: EventStatus;
    readonly provenance?: Provenance;
    readonly restrictions?: TicketRestrictions;
  } = {},
): Promise<Fixture> {
  const caps = createFakeCapabilities();
  const holder = await registered(caps);
  const event = id32<EventId>();
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
    holder: holder.account,
    class: "01" as ClassId,
    provenance: options.provenance ?? "Purchased",
    zone,
    placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
    policy: { kind: "Single" },
    restrictions: options.restrictions ?? NONE,
    attendances: 0,
  });
  return {
    caps,
    holder,
    event,
    ticket,
    transfer: async (from, to, t = ticket) => {
      const command: TransferTicket = {
        ...envelope(),
        kind: "transferTicket",
        event,
        ticket: t,
        receiver: to,
      };
      return execute(caps, profile, await sign(from, command));
    },
    setStatus: async (status) => {
      const current = await caps.registry.getEvent(event);
      if (current === null) throw new Error("fixture event");
      await caps.registry.putEvent({ ...current, status });
    },
    holderOf: async () => (await caps.registry.getTicket(ticket))?.holder,
    cancellationHolder: async () => {
      const result = await query(caps, profile, { kind: "getCancellationHolder", ticket });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    },
  };
}

describe("transferTicket (US-D1)", () => {
  it("INV-2: the receiver becomes the ticket's one holder", async () => {
    const f = await fixture();
    const receiver = id32<AccountId>();
    expect((await f.transfer(f.holder, receiver)).ok).toBe(true);
    expect(await f.holderOf()).toBe(receiver);
    expect(f.caps.log()).toHaveLength(1);
    expect(f.caps.log()[0]?.event).toEqual({ id: f.event, sequence: 0 });
  });

  it("the new holder can transfer it on; the old holder no longer can", async () => {
    const f = await fixture();
    const second = await registered(f.caps);
    await f.transfer(f.holder, second.account);
    expect(codeOf(await f.transfer(f.holder, id32<AccountId>()))).toBe("ERR-NotOwner");
    const third = id32<AccountId>();
    expect((await f.transfer(second, third)).ok).toBe(true);
    expect(await f.holderOf()).toBe(third);
  });

  it("ERR-NotOwner: a signer who does not hold the ticket, the organiser included", async () => {
    const f = await fixture();
    const stranger = await registered(f.caps);
    expect(codeOf(await f.transfer(stranger, stranger.account))).toBe("ERR-NotOwner");
    expect(await f.holderOf()).toBe(f.holder.account);
    expect(f.caps.log()).toHaveLength(0);
  });

  it("AC-B3.3: a granted ticket whose class sets cannot_transfer fails with ERR-CannotTransfer", async () => {
    const f = await fixture({
      provenance: "Granted",
      restrictions: { cannotResale: true, cannotTransfer: true },
    });
    expect(codeOf(await f.transfer(f.holder, id32<AccountId>()))).toBe("ERR-CannotTransfer");
    expect(await f.holderOf()).toBe(f.holder.account);
  });

  it("REQ-TK-4: a granted ticket restricted only against resale still transfers", async () => {
    const f = await fixture({
      provenance: "Granted",
      restrictions: { cannotResale: true, cannotTransfer: false },
    });
    expect((await f.transfer(f.holder, id32<AccountId>())).ok).toBe(true);
  });

  it("INV-12: a purchased ticket transfers while its event is Active or Sealed", async () => {
    for (const status of ["Active", "Sealed"] as const) {
      const f = await fixture({ status, provenance: "Purchased" });
      expect((await f.transfer(f.holder, id32<AccountId>())).ok, status).toBe(true);
    }
  });

  it("AC-A4.2: a Sealed event's ticket transfers normally", async () => {
    const f = await fixture({ status: "Sealed" });
    expect((await f.transfer(f.holder, id32<AccountId>())).ok).toBe(true);
    expect(await f.cancellationHolder()).toBeNull();
  });

  it("INV-16: a Finished event's ticket does not transfer, whatever its provenance", async () => {
    for (const provenance of ["Purchased", "Granted"] as const) {
      const f = await fixture({ status: "Finished", provenance });
      expect(codeOf(await f.transfer(f.holder, id32<AccountId>()))).toBe("ERR-EventFinished");
      expect(await f.holderOf()).toBe(f.holder.account);
    }
  });

  it("ERR-TicketNotFound: a ticket named with the wrong event (plan §5.7a)", async () => {
    const f = await fixture();
    const other = await fixture();
    expect(codeOf(await f.transfer(f.holder, id32<AccountId>(), other.ticket))).toBe(
      "ERR-TicketNotFound",
    );
  });

  describe("check order (plan §5.2)", () => {
    it("the holder before the restriction", async () => {
      const f = await fixture({
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
      });
      const stranger = await registered(f.caps);
      expect(codeOf(await f.transfer(stranger, stranger.account))).toBe("ERR-NotOwner");
    });

    it("INV-16 before the holder", async () => {
      const f = await fixture({ status: "Finished" });
      const stranger = await registered(f.caps);
      expect(codeOf(await f.transfer(stranger, stranger.account))).toBe("ERR-EventFinished");
    });
  });
});

describe("transferTicket — the lazy cancellation snapshot (REQ-EV-10, plan §5.5)", () => {
  it("AC-A5.4: a Cancelled event's ticket still transfers", async () => {
    const f = await fixture({ status: "Cancelled" });
    const receiver = id32<AccountId>();
    expect((await f.transfer(f.holder, receiver)).ok).toBe(true);
    expect(await f.holderOf()).toBe(receiver);
  });

  it("REQ-EV-10: a transfer after cancellation fixes the holder at cancellation, and later transfers leave it", async () => {
    const f = await fixture();
    const second = await registered(f.caps);
    // Before cancellation: a transfer takes no snapshot.
    await f.transfer(f.holder, second.account);
    expect((await f.caps.registry.getTicket(f.ticket))?.cancellationHolder).toBeNull();

    await f.setStatus("Cancelled");
    expect(await f.cancellationHolder()).toBe(second.account);

    const third = await registered(f.caps);
    await f.transfer(second, third.account);
    expect((await f.caps.registry.getTicket(f.ticket))?.cancellationHolder).toBe(second.account);
    expect(await f.cancellationHolder()).toBe(second.account);

    await f.transfer(third, id32<AccountId>());
    expect(await f.cancellationHolder()).toBe(second.account);
  });

  it("no snapshot is taken for a transfer while the event is not Cancelled", async () => {
    for (const status of ["Active", "Sealed"] as const) {
      const f = await fixture({ status });
      await f.transfer(f.holder, id32<AccountId>());
      expect((await f.caps.registry.getTicket(f.ticket))?.cancellationHolder, status).toBeNull();
    }
  });

  it("a refused transfer after cancellation takes no snapshot", async () => {
    const f = await fixture({ status: "Cancelled" });
    const stranger = await registered(f.caps);
    await f.transfer(stranger, stranger.account);
    expect((await f.caps.registry.getTicket(f.ticket))?.cancellationHolder).toBeNull();
    expect(await f.cancellationHolder()).toBe(f.holder.account);
  });
});
