// The hash chain (C7; features/006-log-and-export/plan.md §5.1, §5.2, AD-16).
//
// Every record commits to its predecessor's hash, so a record changed, removed
// or reordered after the fact breaks a link a reader can recompute (REQ-SDK-5).
// A deployment has one total order (INV-15): `sequence` counts every record from
// 0. Every event has its own order too: `eventSequence` counts that event's
// records from 0, so an event's history can be followed on its own — across a
// migration included (REQ-MG-4).
//
// Stores build their log through `linkRecord`, which is pure: the store keeps
// the head and each event's next sequence in its own transaction. `LogChain`
// keeps both in memory, for stores that have nothing else to keep them in.

import type { EventId, Timestamp } from "@ticketto/sdk";
import {
  type ChainedRecord,
  decodeRecord,
  encodeRecord,
  GENESIS_HASH,
  hashRecordBytes,
  type LogInput,
} from "./record.js";

/** Where a chain stands: the sequence the next record takes, and the last record's hash. */
export interface ChainHead {
  readonly next: number;
  /** The last record's hash, as lower-case hex; `GENESIS_HASH` for an empty log. */
  readonly hash: string;
}

/** The head of an empty log. */
export const EMPTY_CHAIN: ChainHead = { next: 0, hash: GENESIS_HASH };

/**
 * An accepted input, as a store hands it to the chain: the rules' logical record
 * (`LogAppend` in `@ticketto/ledger-rules`), field for field.
 */
export interface LogEntry {
  /** By the capabilities' clock. */
  readonly recordedAt: Timestamp;
  /** The event the input concerns; `null` for an input no event owns. */
  readonly event: EventId | null;
  /** The write as submitted, with its authorisation. */
  readonly entry: LogInput;
  /** When a pass was presented, as its submitter claims; `null` when none was claimed. */
  readonly presentedAt: Timestamp | null;
}

/** A record linked onto a chain. */
export interface LinkedRecord {
  readonly record: ChainedRecord;
  /** The record's canonical bytes: what is stored and published. */
  readonly bytes: Uint8Array;
  /** The record's hash, as lower-case hex. */
  readonly hash: string;
  /** The chain's head once this record is appended. */
  readonly head: ChainHead;
}

/**
 * Links `entry` after `head`. `eventSequence` is the next sequence of the entry's
 * event — 0 for its first record — and must be `null` exactly when the entry
 * has no event. Pure: nothing is recorded until the store commits the result.
 * Throws as `encodeRecord` does.
 */
export function linkRecord(
  head: ChainHead,
  entry: LogEntry,
  eventSequence: number | null,
): LinkedRecord {
  if ((entry.event === null) !== (eventSequence === null)) {
    throw new TypeError("an event sequence is given exactly when the entry has an event");
  }
  const record: ChainedRecord = {
    sequence: head.next,
    event: entry.event === null ? null : { id: entry.event, sequence: eventSequence as number },
    recordedAt: entry.recordedAt,
    input: entry.entry,
    presentedAt: entry.presentedAt,
    prevHash: head.hash,
  };
  const bytes = encodeRecord(record);
  const hash = hashRecordBytes(bytes);
  return { record, bytes, hash, head: { next: head.next + 1, hash } };
}

/** Where a chain stands, with the next sequence of every event it has seen. */
export interface ChainState {
  readonly head: ChainHead;
  readonly eventSequences: ReadonlyMap<EventId, number>;
}

/** A chain kept in memory: appends in order, assigning both sequences. */
export class LogChain {
  #head: ChainHead;
  readonly #eventSequences: Map<EventId, number>;

  constructor(state: ChainState = { head: EMPTY_CHAIN, eventSequences: new Map() }) {
    this.#head = state.head;
    this.#eventSequences = new Map(state.eventSequences);
  }

  get head(): ChainHead {
    return this.#head;
  }

  /** The sequence `event`'s next record takes. */
  nextEventSequence(event: EventId): number {
    return this.#eventSequences.get(event) ?? 0;
  }

  /** Appends `entry`, returning the record as linked. Nothing changes if it throws. */
  append(entry: LogEntry): LinkedRecord {
    const eventSequence = entry.event === null ? null : this.nextEventSequence(entry.event);
    const linked = linkRecord(this.#head, entry, eventSequence);
    this.#head = linked.head;
    if (entry.event !== null) this.#eventSequences.set(entry.event, (eventSequence as number) + 1);
    return linked;
  }

  /** A copy of the chain's state, to persist or to resume from. */
  state(): ChainState {
    return { head: this.#head, eventSequences: new Map(this.#eventSequences) };
  }
}

/** Why a record was rejected. */
export type ChainFault =
  /** The bytes are not the canonical encoding of a record. */
  | "malformed"
  /** The record is not at the next position of the total order: one was removed, added or moved. */
  | "sequence"
  /** The record does not commit to its predecessor's hash: one of the two was changed. */
  | "link"
  /** The record is not at the next position of its event's own order. */
  | "eventSequence"
  /** The record's hash is not the one a held checkpoint states for its sequence. */
  | "checkpoint"
  /** The log ends before a record a held checkpoint covers. */
  | "truncated";

/** What a held checkpoint states: the hash of the record at a sequence. */
export interface HeldCheckpoint {
  readonly sequence: number;
  readonly headHash: string;
}

/** The outcome of verifying a chain: its state, or the first record that was rejected. */
export type ChainVerification =
  | { readonly ok: true; readonly state: ChainState }
  | {
      readonly ok: false;
      /** The position, in the total order, of the first record rejected. */
      readonly sequence: number;
      readonly fault: ChainFault;
      readonly detail: string;
    };

/**
 * Verifies that `records`, in the order given, form a chain continuing `from`
 * (by default the empty log). Recomputes every hash, and checks that the total
 * order and each event's order are contiguous. Reports the first record it
 * rejects: a removed or reordered record at the position it left, a changed
 * record at its successor, whose link no longer holds.
 *
 * Given `checkpoints` a party already holds, it also checks that each record they
 * cover still has the stated hash (`REQ-TM-3`). A log rewritten and re-linked
 * consistently passes every other check, but not this one: it is reported at
 * the checkpoint's sequence, or where the log ends if it ends before it.
 * Checkpoints must be verified first (`verifyCheckpoint`); those before `from`
 * are outside the stretch verified, and ignored.
 *
 * Starting mid-log, an event's first record seen sets its baseline unless
 * `from.eventSequences` names it. Whether each input was authorised is not
 * checked here.
 */
export function verifyChain(
  records: Iterable<Uint8Array>,
  from: ChainState = { head: EMPTY_CHAIN, eventSequences: new Map() },
  checkpoints: readonly HeldCheckpoint[] = [],
): ChainVerification {
  const held = new Map<number, string[]>();
  for (const { sequence, headHash } of checkpoints) {
    held.set(sequence, [...(held.get(sequence) ?? []), headHash]);
  }
  const mismatch = (sequence: number, hash: string): ChainVerification | null => {
    const stated = (held.get(sequence) ?? []).find((headHash) => headHash !== hash);
    if (stated === undefined) return null;
    const detail = `record ${sequence} has hash ${hash}; a checkpoint states ${stated}`;
    return { ok: false, sequence, fault: "checkpoint", detail };
  };
  let head = from.head;
  if (head.next > 0) {
    const atFrom = mismatch(head.next - 1, head.hash);
    if (atFrom !== null) return atFrom;
  }
  const eventSequences = new Map(from.eventSequences);
  const fromGenesis = from.head.next === 0;
  for (const bytes of records) {
    const at = head.next;
    let record: ChainedRecord;
    try {
      record = decodeRecord(bytes);
    } catch (error) {
      return { ok: false, sequence: at, fault: "malformed", detail: String(error) };
    }
    if (record.sequence !== at) {
      const detail = `expected sequence ${at}, found ${record.sequence}`;
      return { ok: false, sequence: at, fault: "sequence", detail };
    }
    if (record.prevHash !== head.hash) {
      const detail = `prevHash ${record.prevHash} does not match record ${at - 1}'s hash ${head.hash}`;
      return { ok: false, sequence: at, fault: "link", detail };
    }
    if (record.event !== null) {
      const expected = eventSequences.get(record.event.id) ?? (fromGenesis ? 0 : undefined);
      if (expected !== undefined && record.event.sequence !== expected) {
        const detail = `event ${record.event.id}: expected sequence ${expected}, found ${record.event.sequence}`;
        return { ok: false, sequence: at, fault: "eventSequence", detail };
      }
      eventSequences.set(record.event.id, record.event.sequence + 1);
    }
    head = { next: at + 1, hash: hashRecordBytes(bytes) };
    const diverged = mismatch(at, head.hash);
    if (diverged !== null) return diverged;
  }
  const beyond = Math.max(-1, ...held.keys());
  if (beyond >= head.next) {
    const detail = `the log ends at sequence ${head.next}; a checkpoint covers record ${beyond}`;
    return { ok: false, sequence: head.next, fault: "truncated", detail };
  }
  return { ok: true, state: { head, eventSequences } };
}
