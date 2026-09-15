// T-006-06 — the `C7` test vectors (REQ-TM-3; FORMAT.md).
//
// `buildVectors` generates them deterministically from fixed keys (p256 signing
// is deterministic); `vectors/v0.json` is its checked-in output. Byte strings are
// lower-case hex throughout.

import {
  encodeCommand,
  encodePass,
  encodeSignedAccessPass,
  encodeSignedCommand,
  eventId,
} from "@ticketto/profile-v0";
import type { Command, SignedAccessPass, SignedCommand } from "@ticketto/sdk";
import { toHex } from "../src/bytes.js";
import {
  type ChainedRecord,
  type Checkpoint,
  checkpointSigningPayload,
  decodeRecord,
  EMPTY_CHAIN,
  encodeCheckpoint,
  encodeRecord,
  type LinkedRecord,
  LogChain,
  type LogEntry,
  linkRecord,
  operationDigest,
  signCheckpoint,
  statementFor,
} from "../src/index.js";
import {
  COMMANDS,
  holder,
  organiser,
  publication,
  sampleEntries,
  signCommand,
} from "./fixtures.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A record's fields as FORMAT.md names them. */
function recordJson(record: ChainedRecord): Json {
  const { input } = record;
  const isPass = "pass" in input;
  return {
    sequence: record.sequence,
    event: record.event === null ? null : { id: record.event.id, sequence: record.event.sequence },
    recordedAt: record.recordedAt,
    input: {
      version: 0,
      kind: isPass ? 1 : 0,
      payload: toHex(
        isPass
          ? encodePass((input as SignedAccessPass).pass)
          : encodeCommand((input as SignedCommand).command),
      ),
      authorisation: toHex(input.authorisation),
      framed: toHex(
        isPass
          ? encodeSignedAccessPass(input as SignedAccessPass)
          : encodeSignedCommand(input as SignedCommand),
      ),
    },
    presentedAt: record.presentedAt,
    prevHash: record.prevHash,
  };
}

function checkpointJson(checkpoint: Checkpoint): Json {
  return {
    sequence: checkpoint.sequence,
    headHash: checkpoint.headHash,
    issuedAt: checkpoint.issuedAt,
    signingPayload: toHex(checkpointSigningPayload(checkpoint)),
    authorisation: toHex(checkpoint.authorisation),
    bytes: toHex(encodeCheckpoint(checkpoint)),
  };
}

const hexes = (records: readonly Uint8Array[]): Json => records.map(toHex);

/** Entries of the sample log: two events interleaved, registrations, and a pass. */
async function entries(): Promise<LogEntry[]> {
  const base = await sampleEntries();
  const salt = new Uint8Array(16).fill(0x5b);
  const second = eventId(organiser.signer.account, salt);
  const create = COMMANDS.createEvent as Extract<Command, { kind: "createEvent" }>;
  const secondCreate = await signCommand({ ...create, event: second, salt, capacity: null });
  const secondStatus = await signCommand({
    ...(COMMANDS.setEventStatus as Extract<Command, { kind: "setEventStatus" }>),
    event: second,
    status: "Cancelled",
  });
  const extra = (entry: SignedCommand): LogEntry => ({
    recordedAt: 0,
    event: second,
    entry,
    presentedAt: null,
  });
  const all = [...base];
  all.splice(2, 0, extra(secondCreate));
  all.splice(6, 0, extra(secondStatus));
  return all.map((entry, index) => ({ ...entry, recordedAt: 1_800_000_000_000 + index * 1000 }));
}

export async function buildVectors(): Promise<Json> {
  const log = await entries();
  const chain = new LogChain();
  const linked: LinkedRecord[] = log.map((entry) => chain.append(entry));
  const records = linked.map(({ bytes }) => bytes);
  const state = chain.state();

  const HELD = 5;
  const checkpoint = await signCheckpoint(
    statementFor(linked[HELD]?.head ?? EMPTY_CHAIN, 1_800_000_100_000),
    publication.signer,
  );
  const held = [{ sequence: checkpoint.sequence, headHash: checkpoint.headHash }];

  const relinkedFrom = (index: number): Uint8Array[] => {
    const rewritten = new LogChain();
    return log.map(
      (entry, i) =>
        rewritten.append(i === index ? { ...entry, recordedAt: entry.recordedAt + 1 } : entry)
          .bytes,
    );
  };
  const rewrite = (bytes: Uint8Array, change: Partial<ChainedRecord>) =>
    encodeRecord({ ...decodeRecord(bytes), ...change });

  const changed = [...records];
  changed[3] = rewrite(changed[3] as Uint8Array, { recordedAt: 1 });
  const removed = records.filter((_, i) => i !== 2);
  const reordered = [...records];
  [reordered[4], reordered[5]] = [records[5] as Uint8Array, records[4] as Uint8Array];
  const skipped = (() => {
    const first = linkRecord(EMPTY_CHAIN, log[0] as LogEntry, null);
    const second = linkRecord(first.head, log[1] as LogEntry, 1);
    return [first.bytes, second.bytes];
  })();

  const sample = records[1] as Uint8Array;
  const withByte = (bytes: Uint8Array, at: number, value: number) => {
    const out = bytes.slice();
    out[at] = value;
    return out;
  };

  const otherKey = await signCheckpoint(checkpoint, holder.signer);
  const lateIssue = { ...checkpoint, issuedAt: checkpoint.issuedAt + 1 };
  const checkpointBytes = encodeCheckpoint(checkpoint);

  return {
    format: "ticketto/v0/log",
    recordVersion: 0,
    checkpointVersion: 0,
    genesisHash: "00".repeat(32),
    publicationRegistration: toHex(publication.registration),
    records: linked.map(({ record, bytes, hash }) => ({
      record: recordJson(record),
      bytes: toHex(bytes),
      hash,
    })),
    head: {
      next: state.head.next,
      hash: state.head.hash,
      eventSequences: Object.fromEntries(state.eventSequences),
    },
    checkpoint: checkpointJson(checkpoint),
    invalidCheckpoints: [
      {
        name: "signed by a key other than the publication key",
        bytes: toHex(encodeCheckpoint(otherKey)),
        valid: false,
      },
      {
        name: "statement changed after signing",
        bytes: toHex(encodeCheckpoint(lateIssue)),
        valid: false,
      },
      {
        name: "unsupported checkpoint version",
        bytes: toHex(withByte(checkpointBytes, 0, 1)),
        valid: false,
      },
    ],
    chains: [
      { name: "the sample log", records: hexes(records), checkpoints: [], expected: { ok: true } },
      {
        name: "the sample log against the held checkpoint",
        records: hexes(records),
        checkpoints: held,
        expected: { ok: true },
      },
      {
        name: "a record changed in place",
        records: hexes(changed),
        checkpoints: [],
        expected: { ok: false, sequence: 4, fault: "link" },
      },
      {
        name: "a record removed",
        records: hexes(removed),
        checkpoints: [],
        expected: { ok: false, sequence: 2, fault: "sequence" },
      },
      {
        name: "two records swapped",
        records: hexes(reordered),
        checkpoints: [],
        expected: { ok: false, sequence: 4, fault: "sequence" },
      },
      {
        name: "an event's sequence skipping a place",
        records: hexes(skipped),
        checkpoints: [],
        expected: { ok: false, sequence: 1, fault: "eventSequence" },
      },
      {
        name: "rewritten before the checkpoint and re-linked, without the checkpoint",
        records: hexes(relinkedFrom(2)),
        checkpoints: [],
        expected: { ok: true },
      },
      {
        name: "rewritten before the checkpoint and re-linked, against the checkpoint",
        records: hexes(relinkedFrom(2)),
        checkpoints: held,
        expected: { ok: false, sequence: HELD, fault: "checkpoint" },
      },
      {
        name: "rewritten after the checkpoint and re-linked, against the checkpoint",
        records: hexes(relinkedFrom(HELD + 1)),
        checkpoints: held,
        expected: { ok: true },
      },
      {
        name: "cut short before the checkpoint",
        records: hexes(records.slice(0, 3)),
        checkpoints: held,
        expected: { ok: false, sequence: 3, fault: "truncated" },
      },
    ],
    // FORMAT.md §5.2: an exported operation's C3 digest, for a command record and
    // for an access-pass record (over its framing and presentedAt).
    operationDigests: linked
      .filter(({ record }) => record.sequence === 1 || "pass" in record.input)
      .map(({ record }) => ({
        name: "pass" in record.input ? "a signed access pass" : "a signed command",
        record: record.sequence,
        digest: toHex(operationDigest(record.input, record.presentedAt)),
      })),
    malformedRecords: [
      { name: "trailing byte", bytes: toHex(Uint8Array.of(...sample, 0)) },
      { name: "truncated", bytes: toHex(sample.subarray(0, sample.length - 1)) },
      { name: "unsupported record version", bytes: toHex(withByte(sample, 0, 1)) },
      { name: "invalid option tag on the event", bytes: toHex(withByte(sample, 9, 2)) },
      { name: "unsupported signed-input version", bytes: toHex(withByte(sample, 58, 1)) },
      { name: "unknown signed-input kind", bytes: toHex(withByte(sample, 59, 2)) },
    ],
  };
}
