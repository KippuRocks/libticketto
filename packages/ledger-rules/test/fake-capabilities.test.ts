// T-008-01: the fake capabilities are serialisable — the smoke test F-008's
// unit tests rest on (features/008-ledger-rules/plan.md §5.1, §7).

import type {
  AccountId,
  Authorisation,
  ClassId,
  EventId,
  OperationId,
  PassId,
  Receipt,
  SignedAccessPass,
  Ticket,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import type { Capabilities, Registry } from "../src/index.js";
import { createFakeCapabilities, createFakeClock } from "./fake-capabilities.js";

const ticketId = "01" as TicketId;
const passId = "aa" as PassId;
const eventId = "e1" as EventId;

const ticket: Ticket = {
  id: ticketId,
  event: eventId,
  holder: "h1" as AccountId,
  class: "c1" as ClassId,
  provenance: "Purchased",
  zone: "z1" as ZoneId,
  placement: { kind: "Seated", position: "A1" as never },
  policy: { kind: "Multiple", max: 1_000, until: null },
  restrictions: { cannotResale: false, cannotTransfer: false },
  attendances: 0,
};

const signedPass: SignedAccessPass = {
  pass: { ticket: ticketId, holder: ticket.holder, id: passId, notBefore: 0, notAfter: 60_000 },
  authorisation: new Uint8Array() as Authorisation,
};

/** Lets every other pending transaction run between a read and the write that depends on it. */
async function yieldToOthers(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/** Submits the same pass from `n` concurrent transactions; returns how many consumed it. */
async function consumeConcurrently(caps: Capabilities, n: number): Promise<number> {
  const attempts = Array.from({ length: n }, () =>
    caps.transaction(async (tx) => {
      if (await tx.isPassConsumed(ticketId, passId)) return false;
      await yieldToOthers();
      await tx.recordConsumedPass(ticketId, passId, 60_000);
      return true;
    }),
  );
  return (await Promise.all(attempts)).filter(Boolean).length;
}

/** Increments attendances from `n` concurrent read-modify-write transactions. */
async function incrementConcurrently(caps: Capabilities, n: number): Promise<void> {
  await Promise.all(
    Array.from({ length: n }, () =>
      caps.transaction(async (tx) => {
        const current = await tx.getTicket(ticketId);
        if (current === null) throw new Error("no ticket");
        await yieldToOthers();
        await tx.recordTicketFacts(ticketId, { attendances: current.attendances + 1 });
      }),
    ),
  );
}

/** Capabilities with no isolation at all: what the smoke test must be able to catch. */
function withoutIsolation(caps: Capabilities): Capabilities {
  return { ...caps, transaction: (fn) => fn(caps.registry) };
}

describe("fake capabilities: serialisability smoke test", () => {
  it("AC-E3.2 — the same pass consumed by concurrent transactions is consumed exactly once", async () => {
    expect(await consumeConcurrently(createFakeCapabilities(), 50)).toBe(1);
  });

  it("serialises concurrent read-modify-write transactions, losing no update", async () => {
    const caps = createFakeCapabilities();
    expect(await caps.registry.insertTicket(ticket)).toBe("inserted");
    await incrementConcurrently(caps, 50);
    expect((await caps.registry.getTicket(ticketId))?.attendances).toBe(50);
  });

  it("would catch capabilities that do not isolate transactions", async () => {
    expect(
      await consumeConcurrently(withoutIsolation(createFakeCapabilities()), 50),
    ).toBeGreaterThan(1);
    const caps = withoutIsolation(createFakeCapabilities());
    await caps.registry.insertTicket(ticket);
    await incrementConcurrently(caps, 50);
    expect((await caps.registry.getTicket(ticketId))?.attendances).toBeLessThan(50);
  });

  it("commits every write of a transaction together when it resolves", async () => {
    const caps = createFakeCapabilities();
    const receipt = await caps.transaction(async (tx) => {
      await tx.insertTicket(ticket);
      await tx.recordConsumedPass(ticketId, passId, 60_000);
      const record = await tx.appendLog({ recordedAt: 5, event: eventId, entry: signedPass });
      const receipt: Receipt = {
        operationId: passId as string as OperationId,
        cursor: record.cursor,
      };
      await tx.recordOperation(receipt.operationId, { expiresAt: 60_000, receipt });
      return receipt;
    });
    expect(await caps.registry.getTicket(ticketId)).toEqual({
      ...ticket,
      cancellationHolder: null,
    });
    expect(await caps.registry.isPassConsumed(ticketId, passId)).toBe(true);
    expect(await caps.registry.getOperation(receipt.operationId)).toEqual({
      expiresAt: 60_000,
      receipt,
    });
    expect(caps.log()).toEqual([
      {
        cursor: receipt.cursor,
        recordedAt: 5,
        event: { id: eventId, sequence: 1 },
        entry: signedPass,
        presentedAt: null,
      },
    ]);
  });

  it("commits none of a transaction's writes when it rejects", async () => {
    const caps = createFakeCapabilities();
    const failure = new Error("rejected by the rules");
    await expect(
      caps.transaction(async (tx) => {
        await tx.insertTicket(ticket);
        await tx.recordConsumedPass(ticketId, passId, 60_000);
        await tx.appendLog({ recordedAt: 5, event: eventId, entry: signedPass });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await caps.registry.getTicket(ticketId)).toBeNull();
    expect(await caps.registry.isPassConsumed(ticketId, passId)).toBe(false);
    expect(caps.log()).toEqual([]);
  });

  it("keeps a transaction's writes invisible outside it until it commits", async () => {
    const caps = createFakeCapabilities();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written!: () => void;
    const wrote = new Promise<void>((resolve) => {
      written = resolve;
    });
    const pending = caps.transaction(async (tx) => {
      await tx.insertTicket(ticket);
      written();
      await held;
    });
    await wrote;
    const outside = caps.registry.getTicket(ticketId);
    release();
    await pending;
    // The outside read waited for the transaction, and so sees its commit, never a partial state.
    expect(await outside).toEqual({ ...ticket, cancellationHolder: null });
  });

  it("refuses a transaction's registry once the transaction has settled", async () => {
    const caps = createFakeCapabilities();
    let leaked!: Registry;
    await caps.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked.getTicket(ticketId)).rejects.toThrow("transaction already settled");
  });

  it("reports an existing ticket id instead of overwriting it", async () => {
    const caps = createFakeCapabilities();
    expect(await caps.registry.insertTicket(ticket)).toBe("inserted");
    const other = { ...ticket, holder: "h2" as AccountId };
    expect(await caps.registry.insertTicket(other)).toBe("exists");
    expect((await caps.registry.getTicket(ticketId))?.holder).toBe(ticket.holder);
  });

  it("numbers log records per event, and leaves an unowned write without a sequence", async () => {
    const caps = createFakeCapabilities();
    const entry = signedPass;
    await caps.registry.appendLog({ recordedAt: 1, event: eventId, entry });
    await caps.registry.appendLog({ recordedAt: 2, event: null, entry });
    await caps.registry.appendLog({ recordedAt: 3, event: eventId, entry });
    expect(caps.log().map((r) => r.event)).toEqual([
      { id: eventId, sequence: 1 },
      null,
      { id: eventId, sequence: 2 },
    ]);
    expect(new Set(caps.log().map((r) => r.cursor)).size).toBe(3);
  });

  it("has a clock that only moves forward", () => {
    const clock = createFakeClock(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
    clock.set(200);
    expect(clock.now()).toBe(200);
    expect(() => clock.set(199)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
