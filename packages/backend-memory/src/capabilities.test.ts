// T-005-01: the in-memory C3 capabilities are serialisable. F-008's concurrency
// scenarios (features/008-ledger-rules/plan.md §7 and T-008-11's bar of 1,000
// randomised runs), run over these capabilities instead of the rules' fakes.

import type { Capabilities, Clock, Registry } from "@ticketto/ledger-rules";
import type {
  AccountId,
  Authorisation,
  ClassId,
  Cursor,
  EventId,
  OperationId,
  PassId,
  Receipt,
  SignedAccessPass,
  SignedCommand,
  Ticket,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createMemoryCapabilities } from "./index.js";

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

/** Stands in for BLAKE2b-256 of a signed input's framing; the store never computes it. */
const digest = Uint8Array.from({ length: 32 }, (_, i) => i);

const signedPass: SignedAccessPass = {
  pass: { ticket: ticketId, holder: ticket.holder, id: passId, notBefore: 0, notAfter: 60_000 },
  authorisation: new Uint8Array() as Authorisation,
};

const signedCommand: SignedCommand = {
  command: {
    kind: "setEventStatus",
    operationId: "0f".repeat(16) as OperationId,
    expiresAt: 60_000,
    event: eventId,
    status: "Sealed",
  },
  authorisation: new Uint8Array() as Authorisation,
};

/** Lets every other pending transaction run between a read and the write that depends on it. */
async function yieldToOthers(times = 50): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/**
 * Submits the same pass from `n` concurrent transactions, each yielding
 * `delay(i)` microtasks between its read and its write; returns how many
 * consumed it.
 */
async function consumeConcurrently(
  caps: Capabilities,
  n: number,
  delay: (i: number) => number = () => 50,
): Promise<number> {
  const attempts = Array.from({ length: n }, (_, i) =>
    caps.transaction(async (tx) => {
      await yieldToOthers(delay(i) % 7);
      if (await tx.isPassConsumed(ticketId, passId)) return false;
      await yieldToOthers(delay(i));
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

/** Capabilities with no isolation at all: what these tests must be able to catch. */
function withoutIsolation(caps: Capabilities): Capabilities {
  return { ...caps, transaction: (fn) => fn(caps.registry) };
}

/** A small deterministic generator, so a failing run can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("in-memory capabilities: serialisable transactions", () => {
  it("AC-E3.2 — the same pass consumed by concurrent transactions is consumed exactly once", async () => {
    expect(await consumeConcurrently(createMemoryCapabilities(), 50)).toBe(1);
  });

  it("INV-6 — exactly one of the concurrent consumptions succeeds over 1,000 randomised runs", async () => {
    const random = mulberry32(0x7005_01);
    for (let run = 0; run < 1_000; run += 1) {
      const n = 2 + Math.floor(random() * 9);
      const delays = Array.from({ length: n }, () => Math.floor(random() * 40));
      const consumed = await consumeConcurrently(
        createMemoryCapabilities(),
        n,
        (i) => delays[i] ?? 0,
      );
      expect(consumed, `run ${run}: ${n} transactions, delays ${delays.join(",")}`).toBe(1);
    }
  });

  it("serialises concurrent read-modify-write transactions, losing no update", async () => {
    const caps = createMemoryCapabilities();
    expect(await caps.registry.insertTicket(ticket)).toBe("inserted");
    await incrementConcurrently(caps, 50);
    expect((await caps.registry.getTicket(ticketId))?.attendances).toBe(50);
  });

  it("would catch capabilities that do not isolate transactions", async () => {
    expect(
      await consumeConcurrently(withoutIsolation(createMemoryCapabilities()), 50),
    ).toBeGreaterThan(1);
    const caps = withoutIsolation(createMemoryCapabilities());
    await caps.registry.insertTicket(ticket);
    await incrementConcurrently(caps, 50);
    expect((await caps.registry.getTicket(ticketId))?.attendances).toBeLessThan(50);
  });

  it("commits every write of a transaction together when it resolves", async () => {
    const caps = createMemoryCapabilities();
    const receipt = await caps.transaction(async (tx) => {
      await tx.insertTicket(ticket);
      await tx.recordConsumedPass(ticketId, passId, 60_000);
      const record = await tx.appendLog({
        recordedAt: 5,
        event: eventId,
        entry: signedPass,
        presentedAt: 4,
      });
      const receipt: Receipt = {
        operationId: passId as string as OperationId,
        cursor: record.cursor,
      };
      await tx.recordOperation(receipt.operationId, { expiresAt: 60_000, digest, receipt });
      return receipt;
    });
    expect(await caps.registry.getTicket(ticketId)).toEqual({
      ...ticket,
      cancellationHolder: null,
    });
    expect(await caps.registry.isPassConsumed(ticketId, passId)).toBe(true);
    expect(await caps.registry.getOperation(receipt.operationId)).toEqual({
      expiresAt: 60_000,
      digest,
      receipt,
    });
    const next = await caps.registry.appendLog({
      recordedAt: 6,
      event: eventId,
      entry: signedCommand,
      presentedAt: null,
    });
    expect(next.event).toEqual({ id: eventId, sequence: 1 });
    expect(next.cursor).not.toBe(receipt.cursor);
  });

  it("commits none of a transaction's writes when it rejects", async () => {
    const caps = createMemoryCapabilities();
    await caps.registry.putEvent({ id: eventId } as never);
    const failure = new Error("rejected by the rules");
    await expect(
      caps.transaction(async (tx) => {
        await tx.putEvent({ id: eventId, changed: true } as never);
        await tx.addRegistration(ticket.holder, {
          credential: "c" as never,
          registration: {} as never,
        });
        await tx.insertTicket(ticket);
        await tx.recordConsumedPass(ticketId, passId, 60_000);
        await tx.recordOperation(passId as string as OperationId, {
          expiresAt: 60_000,
          digest,
          receipt: { operationId: passId as string as OperationId, cursor: "1" as Cursor },
        });
        await tx.appendLog({ recordedAt: 5, event: eventId, entry: signedPass, presentedAt: 4 });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await caps.registry.getEvent(eventId)).toEqual({ id: eventId });
    expect(await caps.registry.getRegistrations(ticket.holder)).toEqual([]);
    expect(await caps.registry.getTicket(ticketId)).toBeNull();
    expect(await caps.registry.isPassConsumed(ticketId, passId)).toBe(false);
    expect(await caps.registry.getOperation(passId as string as OperationId)).toBeNull();
    // The rejected append took no place in the log, nor in its event's sequence.
    const first = await caps.registry.appendLog({
      recordedAt: 6,
      event: eventId,
      entry: signedPass,
      presentedAt: 4,
    });
    expect(first).toEqual({
      cursor: first.cursor,
      recordedAt: 6,
      event: { id: eventId, sequence: 0 },
      entry: signedPass,
      presentedAt: 4,
    });
    // Nor did it hold the mutex: a later transaction runs.
    expect(await caps.transaction(async () => "ran")).toBe("ran");
  });

  it("sees a transaction's writes inside it at once", async () => {
    const caps = createMemoryCapabilities();
    await caps.transaction(async (tx) => {
      expect(await tx.insertTicket(ticket)).toBe("inserted");
      expect(await tx.insertTicket(ticket)).toBe("exists");
      await tx.setHolder(ticketId, "h2" as AccountId);
      await tx.recordTicketFacts(ticketId, { attendances: 1, cancellationHolder: ticket.holder });
      expect(await tx.getTicket(ticketId)).toEqual({
        ...ticket,
        holder: "h2",
        attendances: 1,
        cancellationHolder: ticket.holder,
      });
    });
  });

  it("keeps a transaction's writes invisible outside it until it commits", async () => {
    const caps = createMemoryCapabilities();
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
    // An outside read sees the committed state, which does not include the open transaction.
    expect(await caps.registry.getTicket(ticketId)).toBeNull();
    release();
    await pending;
    expect(await caps.registry.getTicket(ticketId)).toEqual({
      ...ticket,
      cancellationHolder: null,
    });
  });

  it("runs a write outside a transaction as a transaction of its own, after any open one", async () => {
    const caps = createMemoryCapabilities();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const pending = caps.transaction(async (tx) => {
      await tx.insertTicket(ticket);
      await held;
      order.push("transaction");
    });
    const outside = caps.registry
      .insertTicket({ ...ticket, holder: "h2" as AccountId })
      .then((result) => {
        order.push("outside");
        return result;
      });
    await yieldToOthers();
    release();
    expect(await outside).toBe("exists");
    await pending;
    expect(order).toEqual(["transaction", "outside"]);
    expect((await caps.registry.getTicket(ticketId))?.holder).toBe(ticket.holder);
  });

  it("refuses a transaction's registry once the transaction has settled", async () => {
    const caps = createMemoryCapabilities();
    let leaked!: Registry;
    await caps.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked.getTicket(ticketId)).rejects.toThrow("transaction already settled");
    await expect(leaked.insertTicket(ticket)).rejects.toThrow("transaction already settled");
    expect(await caps.registry.getTicket(ticketId)).toBeNull();
  });

  it("reports an existing ticket id instead of overwriting it", async () => {
    const caps = createMemoryCapabilities();
    expect(await caps.registry.insertTicket(ticket)).toBe("inserted");
    const other = { ...ticket, holder: "h2" as AccountId };
    expect(await caps.registry.insertTicket(other)).toBe("exists");
    expect((await caps.registry.getTicket(ticketId))?.holder).toBe(ticket.holder);
  });

  it("keeps credential registrations by account, in registration order", async () => {
    const caps = createMemoryCapabilities();
    const account = "a1" as AccountId;
    const first = { credential: "c1" as never, registration: new Uint8Array([1]) as never };
    const second = { credential: "c2" as never, registration: new Uint8Array([2]) as never };
    await caps.registry.addRegistration(account, first);
    await caps.registry.addRegistration(account, second);
    expect(await caps.registry.getRegistrations(account)).toEqual([first, second]);
    expect(await caps.registry.getRegistrations("a2" as AccountId)).toEqual([]);
  });

  it("numbers log records per event from 0, and leaves an unowned write without a sequence", async () => {
    const caps = createMemoryCapabilities();
    const entry = signedPass;
    const records = [
      await caps.registry.appendLog({ recordedAt: 1, event: eventId, entry, presentedAt: 1 }),
      await caps.registry.appendLog({ recordedAt: 2, event: null, entry, presentedAt: 2 }),
      await caps.registry.appendLog({ recordedAt: 3, event: eventId, entry, presentedAt: 3 }),
      await caps.registry.appendLog({
        recordedAt: 4,
        event: "e2" as EventId,
        entry,
        presentedAt: 4,
      }),
    ];
    expect(records.map((r) => r.event)).toEqual([
      { id: eventId, sequence: 0 },
      null,
      { id: eventId, sequence: 1 },
      { id: "e2", sequence: 0 },
    ]);
    expect(new Set(records.map((r) => r.cursor)).size).toBe(4);
  });

  it("REQ-CM-1: keeps and returns an operation's digest as recorded, computing nothing", async () => {
    const caps = createMemoryCapabilities();
    const id = "0f".repeat(16) as OperationId;
    const receipt: Receipt = { operationId: id, cursor: "1" as Cursor };
    const recorded = Uint8Array.from(digest);
    await caps.registry.recordOperation(id, { expiresAt: 60_000, digest: recorded, receipt });
    recorded.fill(0);
    const returned = await caps.registry.getOperation(id);
    expect(returned).toEqual({ expiresAt: 60_000, digest, receipt });
    returned?.digest.fill(0);
    expect((await caps.registry.getOperation(id))?.digest).toEqual(digest);
    expect(await caps.registry.getOperation("other" as OperationId)).toBeNull();
  });

  it("carries a log append's presentedAt into the record, and null for a command", async () => {
    const caps = createMemoryCapabilities();
    const pass = await caps.registry.appendLog({
      recordedAt: 7,
      event: eventId,
      entry: signedPass,
      presentedAt: 6,
    });
    const command = await caps.registry.appendLog({
      recordedAt: 8,
      event: eventId,
      entry: signedCommand,
      presentedAt: null,
    });
    expect([pass.presentedAt, command.presentedAt]).toEqual([6, null]);
    expect([pass.entry, command.entry]).toEqual([signedPass, signedCommand]);
  });

  it("uses the clock it is given, and otherwise a monotonic system clock", () => {
    const clock: Clock = { now: () => 42 };
    expect(createMemoryCapabilities({ clock }).clock).toBe(clock);
    const system = createMemoryCapabilities().clock;
    const before = Date.now();
    const readings = Array.from({ length: 100 }, () => system.now());
    expect(readings[0]).toBeGreaterThanOrEqual(before);
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]).toBeGreaterThanOrEqual(readings[i - 1] ?? 0);
    }
  });
});
