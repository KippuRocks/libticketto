// The import driver and its observable-state verification (C7;
// features/006-log-and-export/plan.md §5.5, REQ-MG-3, REQ-MG-2).
//
// Import does not re-execute history. The backend appends the exported records
// verbatim and loads the snapshot, through its optional `migration` port member
// (F-002 §5.8a); this driver then verifies, through the port alone, that what
// the backend now shows is what was exported:
//
// - the log read from the start re-links, record by record, into exactly the
//   exported records — the same sequences, event sequences, inputs and hashes —
//   and ends at the checkpoint's head hash;
// - `getEvent`, `getTicket` and `getCredential` answer every snapshot entry
//   with that entry;
// - `getCancellationHolder` answers every ticket of a cancelled event with its
//   exported holder.
//
// Consumed passes and operations cannot be observed through queries; a
// backend's own tests probe them by resubmitting (F-005, T-005-06).
//
// `@ticketto/log` depends on the SDK for types only, so this driver calls the
// port members directly rather than `@ticketto/sdk/migration`.

import type { Backend, Cursor, LogRecord, MigrationFailure, Registration } from "@ticketto/sdk";
import { equalBytes } from "./bytes.js";
import { type ChainHead, EMPTY_CHAIN, linkRecord } from "./chain.js";
import {
  encodeSnapshotEvent,
  encodeSnapshotTicket,
  type LedgerExport,
  readExport,
} from "./export.js";

/** The SDK's `LOG_START`: the cursor before the first record. */
const LOG_START = "" as Cursor;

/** Which part of a backend's observable state disagreed with the export. */
export type ImportMismatch =
  /** The log read from the start is not the exported records. */
  | "log"
  /** The log does not end at the checkpoint's head hash. */
  | "head"
  /** `getEvent` does not answer an exported event with it. */
  | "event"
  /** `getTicket` does not answer an exported ticket with it. */
  | "ticket"
  /** `getCredential` does not answer an exported credential with its registration. */
  | "credential"
  /** `getCancellationHolder` does not answer a ticket of a cancelled event with its exported holder. */
  | "cancellationHolder";

/** The outcome of verifying an import. */
export type ImportVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly mismatch: ImportMismatch; readonly detail: string };

/** Options for reading the log during verification. */
export interface VerifyImportOptions {
  /** Records asked for per `log.read`. Defaults to 1000. */
  readonly pageSize?: number;
}

const mismatch = (kind: ImportMismatch, detail: string): ImportVerification => ({
  ok: false,
  mismatch: kind,
  detail,
});

/** Links a record the port returned, as the export would have carried it. */
function relink(head: ChainHead, record: LogRecord) {
  return linkRecord(
    head,
    {
      recordedAt: record.recordedAt,
      event: record.event?.id ?? null,
      entry: record.entry,
      presentedAt: record.presentedAt,
    },
    record.event?.sequence ?? null,
  );
}

/**
 * Verifies, through the port alone, that `backend`'s observable state is
 * `ledger` (plan §5.5). Reports the first disagreement found, checking the log
 * first, then events, tickets, credentials and cancellation holders.
 */
export async function verifyImport(
  backend: Backend,
  ledger: LedgerExport,
  options: VerifyImportOptions = {},
): Promise<ImportVerification> {
  const pageSize = options.pageSize ?? 1000;
  const { records, checkpoint, snapshot } = ledger;

  // The log, from the start.
  let head = EMPTY_CHAIN;
  let cursor = LOG_START;
  for (;;) {
    const page = await backend.log.read(cursor, pageSize);
    if (!page.ok) return mismatch("log", `reading the log failed: ${page.error.code}`);
    const { records: read, next } = page.value;
    if (read.length === 0) break;
    for (const record of read) {
      const at = head.next;
      const exported = records[at];
      if (exported === undefined) {
        return mismatch("log", `the log continues past the ${records.length} exported records`);
      }
      let bytes: Uint8Array;
      try {
        const linked = relink(head, record);
        bytes = linked.bytes;
        head = linked.head;
      } catch (error) {
        return mismatch("log", `record ${at} cannot be re-linked: ${String(error)}`);
      }
      if (!equalBytes(bytes, exported)) {
        return mismatch("log", `record ${at} is not the exported record`);
      }
    }
    if (next === cursor) return mismatch("log", "the log reader does not advance");
    cursor = next;
  }
  if (head.next !== records.length) {
    return mismatch("log", `the log ends at ${head.next} of ${records.length} exported records`);
  }
  const expectedHead = checkpoint?.headHash ?? EMPTY_CHAIN.hash;
  if (head.hash !== expectedHead) {
    return mismatch(
      "head",
      `the log ends at hash ${head.hash}, the checkpoint states ${expectedHead}`,
    );
  }

  // Point queries, for every snapshot entry.
  for (const event of snapshot.events) {
    const answer = await backend.query({ kind: "getEvent", event: event.id });
    if (!answer.ok || !sameBytes(encodeSnapshotEvent, answer.value, event)) {
      return mismatch("event", `event ${event.id}`);
    }
  }
  for (const ticket of snapshot.tickets) {
    const answer = await backend.query({ kind: "getTicket", ticket: ticket.id });
    if (!answer.ok || !sameBytes(encodeSnapshotTicket, answer.value, ticket)) {
      return mismatch("ticket", `ticket ${ticket.id}`);
    }
  }
  for (const { account, credential, registration } of snapshot.credentials) {
    const answer = await backend.query({ kind: "getCredential", account, credential });
    if (!answer.ok || answer.value === null || !equalBytes(answer.value, registration)) {
      return mismatch("credential", `credential ${credential} of account ${account}`);
    }
  }
  for (const { ticket, holder } of snapshot.cancellationHolders) {
    const answer = await backend.query({ kind: "getCancellationHolder", ticket });
    if (!answer.ok || answer.value !== holder) {
      return mismatch("cancellationHolder", `ticket ${ticket}`);
    }
  }
  return { ok: true };
}

/** Whether `actual` encodes to the same canonical bytes as `expected`; `false` when it cannot. */
function sameBytes<T>(encode: (value: T) => Uint8Array, actual: T, expected: T): boolean {
  try {
    return equalBytes(encode(actual), encode(expected));
  } catch {
    return false;
  }
}

/** The outcome of a verified import. */
export type VerifiedImport =
  | { readonly ok: true; readonly ledger: LedgerExport }
  /** The export was refused before or by the backend: malformed, unsupported, or not empty. */
  | { readonly ok: false; readonly failure: MigrationFailure }
  /** The backend imported, and its observable state is not the export. */
  | {
      readonly ok: false;
      readonly verification: Extract<ImportVerification, { ok: false }>;
    };

/** Options for `importVerified`. */
export interface ImportVerifiedOptions extends VerifyImportOptions {
  /** When given, the export's checkpoint must be signed by this publication key (`C7` §4.2). */
  readonly publication?: Registration;
}

/**
 * The import driver: reads `stream` as an export, refusing a malformed one
 * before the backend sees it; imports it into `target` through its `migration`
 * member; then verifies `target`'s observable state against the export.
 *
 * The export is held in memory while it is imported, which V0 volumes allow;
 * `NFR-10`'s bound is beyond V0.
 */
export async function importVerified(
  target: Backend,
  stream: AsyncIterable<Uint8Array>,
  options: ImportVerifiedOptions = {},
): Promise<VerifiedImport> {
  const { migration } = target;
  if (migration === undefined) {
    return {
      ok: false,
      failure: { ok: false, reason: "unsupported", detail: "the backend offers no migration" },
    };
  }
  const chunks: Uint8Array[] = [];
  async function* tee(): AsyncIterable<Uint8Array> {
    for await (const chunk of stream) {
      chunks.push(chunk);
      yield chunk;
    }
  }
  const read = await readExport(
    tee(),
    options.publication === undefined ? {} : { publication: options.publication },
  );
  if (!read.ok) return { ok: false, failure: read };
  async function* replay(): AsyncIterable<Uint8Array> {
    yield* chunks;
  }
  const imported = await migration.import(replay());
  if (!imported.ok) return { ok: false, failure: imported };
  const verification = await verifyImport(
    target,
    read.ledger,
    options.pageSize === undefined ? {} : { pageSize: options.pageSize },
  );
  if (!verification.ok) return { ok: false, verification };
  return { ok: true, ledger: read.ledger };
}
