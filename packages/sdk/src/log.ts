// The log reader — features/002-sdk/plan.md §5.8, REQ-SDK-5, AD-16, AD-17.
//
// Every state-changing call produces an append-only, ordered log record. This
// is the record's logical shape only: how records are chained, checkpointed and
// verified is the published log's concern (C7), never the surface's.
//
// Pulling by cursor is authoritative. A hint only says "there is data past this
// cursor" and carries no record, so a lost hint costs latency and never data
// (AD-17).

import type { SignedCommand } from "./capabilities.js";
import type { SignedAccessPass } from "./commands.js";
import type { Result } from "./errors.js";
import type { Brand, Count, EventId, Timestamp } from "./identifiers.js";

/** A position in a deployment's log. Opaque: compare cursors for equality only. */
export type Cursor = Brand<string, "Cursor">;

/** The cursor before the first record: reading from it reads the whole log. */
export const LOG_START = "" as Cursor;

/** One accepted write, in the deployment's total order (`AD-16`). */
export interface LogRecord {
  /** This record's position. Reading from it continues after this record. */
  readonly cursor: Cursor;
  /** When the ledger recorded the write, by its clock (`REQ-SDK-3`). */
  readonly recordedAt: Timestamp;
  /** The event the write concerns, and its place in that event's sequence; `null` for a write no event owns. */
  readonly event: { readonly id: EventId; readonly sequence: Count } | null;
  /** The write as submitted, with its authorisation. */
  readonly entry: SignedCommand | SignedAccessPass;
}

/** One page of the log. */
export interface LogPage {
  /** Records after the cursor read from, in log order; at most the limit asked for. */
  readonly records: readonly LogRecord[];
  /** Where to read from next: the last record's cursor, or the cursor read from when there are none. */
  readonly next: Cursor;
}

/** Reads a deployment's log (`REQ-SDK-5`). */
export interface LogReader {
  read(from: Cursor, limit: number): Promise<Result<LogPage>>;
  /** Signals that records exist past a cursor. Carries cursors only, never records (`AD-17`). */
  hints(): AsyncIterable<Cursor>;
}
