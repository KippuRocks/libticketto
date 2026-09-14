// T-006-02 — the chain builder, with total and per-event sequences
// (REQ-SDK-5, REQ-MG-4, INV-15).

import type { CommandKind, EventId } from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMANDS, event, samplePass, signCommand } from "../test/fixtures.js";
import {
  type ChainedRecord,
  decodeRecord,
  EMPTY_CHAIN,
  encodeRecord,
  GENESIS_HASH,
  hashRecordBytes,
  type LinkedRecord,
  LogChain,
  LogContentError,
  type LogEntry,
  linkRecord,
  verifyChain,
} from "./index.js";

const other = "ee".repeat(32) as EventId;
let entries: LogEntry[];

beforeAll(async () => {
  const command = async (kind: CommandKind, eventId: EventId | null = event) => {
    const signed = await signCommand(COMMANDS[kind]);
    // Re-point the command at `eventId`, so two events interleave.
    const input =
      eventId === null || eventId === event
        ? signed
        : { ...signed, command: { ...signed.command, event: eventId } };
    return { event: eventId, recordedAt: 0, entry: input, presentedAt: null } as LogEntry;
  };
  const pass: LogEntry = {
    event,
    recordedAt: 0,
    entry: await samplePass(),
    presentedAt: 1_800_000_000_001,
  };
  entries = [
    await command("registerCredential", null),
    await command("createEvent"),
    await command("createEvent", other),
    await command("issueTicket"),
    await command("setEventStatus", other),
    pass,
    await command("registerCredential", null),
    await command("transferTicket"),
  ].map((entry, index) => ({ ...entry, recordedAt: 1_800_000_000_000 + index }));
});

function build(): LinkedRecord[] {
  const chain = new LogChain();
  return entries.map((entry) => chain.append(entry));
}

describe("INV-15 one total order per deployment", () => {
  it("numbers every record from 0 and links each to its predecessor", () => {
    const linked = build();
    expect(linked.map(({ record }) => record.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(linked[0]?.record.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < linked.length; i++) {
      expect(linked[i]?.record.prevHash).toBe(linked[i - 1]?.hash);
    }
    for (const { bytes, hash, record } of linked) {
      expect(hash).toBe(hashRecordBytes(bytes));
      expect(decodeRecord(bytes)).toEqual(record);
    }
  });

  it("appending records yields a chain the verifier accepts", () => {
    const linked = build();
    const result = verifyChain(linked.map(({ bytes }) => bytes));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.head).toEqual(linked.at(-1)?.head);
    expect(result.state.eventSequences).toEqual(
      new Map([
        [event, 4],
        [other, 2],
      ]),
    );
  });

  it("accepts the empty log", () => {
    expect(verifyChain([])).toEqual({
      ok: true,
      state: { head: EMPTY_CHAIN, eventSequences: new Map() },
    });
  });
});

describe("REQ-MG-4 per-event sequences", () => {
  it("count each event's records on their own, skipping records of no event", () => {
    const linked = build();
    const byEvent = (id: EventId) =>
      linked.flatMap(({ record }) => (record.event?.id === id ? [record.event.sequence] : []));
    expect(byEvent(event)).toEqual([0, 1, 2, 3]);
    expect(byEvent(other)).toEqual([0, 1]);
    expect(linked.filter(({ record }) => record.event === null)).toHaveLength(2);
  });

  it("are reported when a record skips a place in its event's order", () => {
    const [first, second] = entries as [LogEntry, LogEntry];
    const a = linkRecord(EMPTY_CHAIN, first, null);
    const b = linkRecord(a.head, second, 1); // createEvent's first record, numbered 1
    expect(verifyChain([a.bytes, b.bytes])).toMatchObject({
      ok: false,
      sequence: 1,
      fault: "eventSequence",
    });
  });
});

describe("T-006-02 chain builder", () => {
  it("resumes from a saved state exactly where it left off", () => {
    const whole = build();
    const chain = new LogChain();
    for (const entry of entries.slice(0, 4)) chain.append(entry);
    const resumed = new LogChain(chain.state());
    const rest = entries.slice(4).map((entry) => resumed.append(entry));
    expect(rest.map(({ bytes }) => bytes)).toEqual(whole.slice(4).map(({ bytes }) => bytes));
  });

  it("linkRecord is pure, and wants an event sequence exactly when there is an event", () => {
    const [first, second] = entries as [LogEntry, LogEntry];
    expect(linkRecord(EMPTY_CHAIN, second, 0)).toEqual(linkRecord(EMPTY_CHAIN, second, 0));
    expect(() => linkRecord(EMPTY_CHAIN, first, 0)).toThrow(TypeError);
    expect(() => linkRecord(EMPTY_CHAIN, second, null)).toThrow(TypeError);
  });

  it("leaves the chain unchanged when an entry is refused", () => {
    const chain = new LogChain();
    chain.append(entries[1] as LogEntry);
    const before = chain.state();
    const entry = { ...(entries[3] as LogEntry).entry, note: "Ada" };
    expect(() => chain.append({ ...(entries[3] as LogEntry), entry } as LogEntry)).toThrow(
      LogContentError,
    );
    expect(chain.state()).toEqual(before);
    expect(chain.nextEventSequence(event)).toBe(1);
  });

  it("verifies a later stretch of the log from a saved state", () => {
    const linked = build();
    const chain = new LogChain();
    for (const entry of entries.slice(0, 3)) chain.append(entry);
    const rest = linked.slice(3).map(({ bytes }) => bytes);
    expect(verifyChain(rest, chain.state())).toMatchObject({ ok: true });
    // Without the event sequences, each event's first record seen sets its baseline.
    const headOnly = { head: chain.head, eventSequences: new Map() };
    expect(verifyChain(rest, headOnly)).toMatchObject({ ok: true });
    // Against the wrong head, the first record's link fails.
    expect(verifyChain(rest, { ...headOnly, head: { next: 3, hash: GENESIS_HASH } })).toMatchObject(
      {
        ok: false,
        sequence: 3,
        fault: "link",
      },
    );
  });
});

describe("REQ-SDK-5 tampering is detected at the right sequence", () => {
  const rewrite = (bytes: Uint8Array, change: Partial<ChainedRecord>) =>
    encodeRecord({ ...decodeRecord(bytes), ...change });

  it("a changed record breaks its successor's link", () => {
    const records = build().map(({ bytes }) => bytes);
    records[3] = rewrite(records[3] as Uint8Array, { recordedAt: 1 });
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 4, fault: "link" });
  });

  it("a record whose prevHash was rewritten breaks at its own position", () => {
    const records = build().map(({ bytes }) => bytes);
    records[5] = rewrite(records[5] as Uint8Array, { prevHash: "11".repeat(32) });
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 5, fault: "link" });
  });

  it("a removed record", () => {
    const records = build().map(({ bytes }) => bytes);
    records.splice(2, 1);
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 2, fault: "sequence" });
  });

  it("reordered records", () => {
    const records = build().map(({ bytes }) => bytes);
    [records[4], records[5]] = [records[5] as Uint8Array, records[4] as Uint8Array];
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 4, fault: "sequence" });
  });

  it("a record renumbered into a removed one's place", () => {
    const records = build().map(({ bytes }) => bytes);
    const removed = records.splice(6, 1);
    expect(removed).toHaveLength(1);
    records[6] = rewrite(records[6] as Uint8Array, { sequence: 6 });
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 6, fault: "link" });
  });

  it("bytes that are not a record", () => {
    const records = build().map(({ bytes }) => bytes);
    records[1] = (records[1] as Uint8Array).subarray(1);
    expect(verifyChain(records)).toMatchObject({ ok: false, sequence: 1, fault: "malformed" });
  });
});
