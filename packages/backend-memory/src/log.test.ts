// T-005-03: log production through @ticketto/log, and the LogReader with hints
// (REQ-SDK-5, AD-17; features/005-backend-memory/plan.md §2).

import type { LogAppend } from "@ticketto/ledger-rules";
import { decodeRecord, verifyChain } from "@ticketto/log";
import { createProfileV0 } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import {
  type Cursor,
  createTicketto,
  LOG_START,
  type LogRecord,
  type Sponsorship,
  type ZoneId,
} from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { event, otherEvent, registerCommand, signedPass, statusCommand } from "../test/fixtures.js";
import { backendOver } from "./backend.js";
import { createMemoryStore } from "./capabilities.js";

const profile = createProfileV0({ rpId: "backend-memory.ticketto.test" });

let appends: LogAppend[];
beforeAll(async () => {
  appends = [
    { recordedAt: 10, event: null, entry: await registerCommand(1), presentedAt: null },
    { recordedAt: 11, event, entry: await statusCommand(2), presentedAt: null },
    {
      recordedAt: 12,
      event: otherEvent,
      entry: await statusCommand(3, otherEvent),
      presentedAt: null,
    },
    { recordedAt: 13, event, entry: await signedPass(), presentedAt: 12 },
    { recordedAt: 14, event, entry: await statusCommand(4), presentedAt: null },
  ];
});

/** A fresh store and the backend's log reader over it. */
function fresh() {
  const store = createMemoryStore({ clock: { now: () => 0 } });
  return { store, log: backendOver(store, profile).log };
}

/** Commits `appends`, one transaction each. */
async function appendEach(store: ReturnType<typeof createMemoryStore>, entries: LogAppend[]) {
  const records: LogRecord[] = [];
  for (const append of entries) records.push(await store.capabilities.registry.appendLog(append));
  return records;
}

async function readAll(log: ReturnType<typeof fresh>["log"], from: Cursor, limit: number) {
  const records: LogRecord[] = [];
  let cursor = from;
  for (;;) {
    const page = await log.read(cursor, limit);
    if (!page.ok) throw new Error(page.error.code);
    if (page.value.records.length === 0) return { records, next: page.value.next };
    records.push(...page.value.records);
    cursor = page.value.next;
  }
}

describe("in-memory backend: the log", () => {
  it("REQ-SDK-5: an accepted write is in the log at its receipt's cursor, read through the SDK", async () => {
    const { store } = fresh();
    const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x31) });
    const claimed = profile.registrationAccount(organiser.registration);
    if (!claimed.ok) throw new Error(claimed.error.code);
    await store.capabilities.registry.addRegistration(organiser.signer.account, {
      credential: claimed.value.credential,
      registration: organiser.registration,
    });
    const ticketto = createTicketto({
      backend: backendOver(store, profile),
      profile,
      sponsor: { sponsor: async () => ({ ok: true, value: new Uint8Array() as Sponsorship }) },
      operationLifetime: 60_000,
      now: () => 0,
      randomBytes: (length) => new Uint8Array(length).fill(0x42),
    });
    const { id, submission } = ticketto.createEvent(organiser.signer, {
      salt: new Uint8Array(16).fill(1),
      zones: [{ id: "7c".repeat(32) as ZoneId, kind: "Seated" }],
      capacity: null,
      metadata: null,
    });
    const receipt = await submission;
    if (!receipt.ok) throw new Error(receipt.error.code);
    const page = await ticketto.log.read(LOG_START, 10);
    if (!page.ok) throw new Error(page.error.code);
    expect(page.value.records).toHaveLength(1);
    expect(page.value.records[0]?.cursor).toBe(receipt.value.cursor);
    expect(page.value.records[0]?.event).toEqual({ id, sequence: 0 });
    expect(verifyChain(store.records().map(({ linked }) => linked.bytes)).ok).toBe(true);
  });

  it("REQ-SDK-5: reading from cursor zero returns every record in order", async () => {
    const { store, log } = fresh();
    const written = await appendEach(store, appends);
    const page = await log.read(LOG_START, 1_000);
    expect(page).toEqual({ ok: true, value: { records: written, next: written.at(-1)?.cursor } });
    expect(page.ok && page.value.records.map((r) => r.entry)).toEqual(appends.map((a) => a.entry));
    expect(page.ok && page.value.records.map((r) => r.event)).toEqual([
      null,
      { id: event, sequence: 0 },
      { id: otherEvent, sequence: 0 },
      { id: event, sequence: 1 },
      { id: event, sequence: 2 },
    ]);
    expect(page.ok && page.value.records.map((r) => [r.recordedAt, r.presentedAt])).toEqual(
      appends.map((a) => [a.recordedAt, a.presentedAt]),
    );
  });

  it("REQ-SDK-5: produces the log as a hash chain a party that did not produce it can verify", async () => {
    const { store } = fresh();
    await appendEach(store, appends);
    const stored = store.records();
    const verified = verifyChain(stored.map(({ linked }) => linked.bytes));
    expect(verified.ok).toBe(true);
    for (const [i, { record, linked }] of stored.entries()) {
      expect(linked.record.sequence).toBe(i);
      expect(decodeRecord(linked.bytes)).toEqual(linked.record);
      expect(linked.record.event).toEqual(record.event);
      expect(linked.record.input).toEqual(record.entry);
    }
  });

  it("reads page by page from any cursor, and returns the cursor read from when nothing follows", async () => {
    const { store, log } = fresh();
    const written = await appendEach(store, appends);
    expect(await readAll(log, LOG_START, 2)).toEqual({
      records: written,
      next: written.at(-1)?.cursor,
    });
    const second = written[1]?.cursor as Cursor;
    expect((await readAll(log, second, 1)).records).toEqual(written.slice(2));
    const last = written.at(-1)?.cursor as Cursor;
    expect(await log.read(last, 10)).toEqual({ ok: true, value: { records: [], next: last } });
    expect(await fresh().log.read(LOG_START, 10)).toEqual({
      ok: true,
      value: { records: [], next: LOG_START },
    });
  });

  it("links the records of one transaction together, and a rolled-back transaction's not at all", async () => {
    const { store, log } = fresh();
    const [first, second, third, fourth, fifth] = appends as [
      LogAppend,
      LogAppend,
      LogAppend,
      LogAppend,
      LogAppend,
    ];
    await store.capabilities.transaction(async (tx) => {
      await tx.appendLog(first);
      await tx.appendLog(second);
    });
    await expect(
      store.capabilities.transaction(async (tx) => {
        await tx.appendLog(third);
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    await store.capabilities.transaction(async (tx) => {
      await tx.appendLog(fourth);
      await tx.appendLog(fifth);
    });
    const page = await log.read(LOG_START, 10);
    expect(page.ok && page.value.records.map((r) => r.entry)).toEqual(
      [first, second, fourth, fifth].map((a) => a.entry),
    );
    expect(verifyChain(store.records().map(({ linked }) => linked.bytes)).ok).toBe(true);
  });

  it("refuses to record an input the log cannot carry, rolling its transaction back", async () => {
    const { store, log } = fresh();
    const pass = appends[3] as LogAppend;
    await expect(
      store.capabilities.transaction(async (tx) => {
        await tx.appendLog(appends[0] as LogAppend);
        // A pass's record names its ticket's event: one naming none is malformed.
        await tx.appendLog({ ...pass, event: null });
      }),
    ).rejects.toThrow(TypeError);
    expect(await log.read(LOG_START, 10)).toEqual({
      ok: true,
      value: { records: [], next: LOG_START },
    });
  });

  it("throws for a cursor the log never issued, and for a limit that is not a positive integer", async () => {
    const { store, log } = fresh();
    await appendEach(store, appends.slice(0, 2));
    await expect(log.read("2" as Cursor, 10)).rejects.toThrow(RangeError);
    await expect(log.read("01" as Cursor, 10)).rejects.toThrow(RangeError);
    await expect(log.read("head" as Cursor, 10)).rejects.toThrow(RangeError);
    await expect(log.read(LOG_START, 0)).rejects.toThrow(RangeError);
    await expect(log.read(LOG_START, 1.5)).rejects.toThrow(RangeError);
  });
});

describe("in-memory backend: log hints (AD-17)", () => {
  it("AD-17: hints the head on subscribing, then each new head — cursors only, never records", async () => {
    const { store, log } = fresh();
    const hints = log.hints()[Symbol.asyncIterator]();
    expect(await hints.next()).toEqual({ done: false, value: LOG_START });
    const waiting = hints.next();
    const [first] = await appendEach(store, appends.slice(0, 1));
    expect(await waiting).toEqual({ done: false, value: first?.cursor });
    const [second] = await appendEach(store, appends.slice(1, 2));
    expect(await hints.next()).toEqual({ done: false, value: second?.cursor });
    await hints.return?.();
  });

  it("AD-17: coalesces heads a reader has not taken into the latest one", async () => {
    const { store, log } = fresh();
    const hints = log.hints()[Symbol.asyncIterator]();
    await hints.next();
    const written = await appendEach(store, appends);
    expect(await hints.next()).toEqual({ done: false, value: written.at(-1)?.cursor });
    // Nothing moved since: the next hint waits for the next commit.
    let settled = false;
    const next = hints.next().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await store.capabilities.transaction(async (tx) => {
      await tx.putEvent({ id: event } as never);
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await hints.return?.();
    expect(await next).toEqual({ done: true, value: undefined });
  });

  it("AD-17: a reader that subscribes late starts from the current head, and converges by reading", async () => {
    const { store, log } = fresh();
    const written = await appendEach(store, appends);
    const hints = log.hints()[Symbol.asyncIterator]();
    const { value: head } = await hints.next();
    expect(head).toBe(written.at(-1)?.cursor);
    expect((await readAll(log, LOG_START, 3)).next).toBe(head);
    await hints.return?.();
  });

  it("stops hinting once a reader returns, and hints every reader independently", async () => {
    const { store, log } = fresh();
    const a = log.hints()[Symbol.asyncIterator]();
    const b = log.hints()[Symbol.asyncIterator]();
    await a.next();
    await b.next();
    await a.return?.();
    const [record] = await appendEach(store, appends.slice(0, 1));
    expect(await a.next()).toEqual({ done: true, value: undefined });
    expect(await b.next()).toEqual({ done: false, value: record?.cursor });
    await b.return?.();
  });
});
