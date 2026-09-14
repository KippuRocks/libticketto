// C4 responses — protocol/C4.md §4.3, row by row.
//
// Every response, and every failure to get one, falls in exactly one row of
// C4.md §4.3. This module decides the row and returns it as an `Outcome`. It
// retries nothing, resubmits nothing, and raises nothing on the SDK surface:
// what the binding then does with a row — the retry budget, resubmission, a
// failed submission — is the port's (F-007 §5).
//
// A response that fits no row — an unknown wire code, a code on the wrong
// status or endpoint, a §10 code that is not ledger-origin, a 2xx body that is
// not C4 — is a `defect`, never a value.

import {
  type AssuranceDeclaration,
  type Cursor,
  INVARIANT_IDS,
  type OperationId,
  type Query,
  type QueryResult,
  type Receipt,
  type Result,
  TICKETTO_ERROR_CODES,
  TICKETTO_ERROR_ORIGINS,
  type TickettoError,
  type TickettoErrorCode,
  type Timestamp,
} from "@ticketto/sdk";
import { fromHex, isHex } from "./hex.js";
import { translateWireCode } from "./translation.js";
import { type Endpoint, isCount, isCursor, isOperationId, isSubmissionToken } from "./wire.js";

/** A wire response the binding cannot act on (C4.md §4.3): never retried, never mapped. */
export interface Defect {
  readonly outcome: "defect";
  /** What was wrong, for the defect report. Not an SDK error. */
  readonly reason: string;
}

/**
 * `503 unavailable`, a transport failure, or a `5xx` without a C4 body: retry
 * with backoff. When the binding's budget is exhausted it rejects with
 * `ERR-LedgerUnavailable` (C4.md §4.3, amendment 0003 G8).
 */
export interface Retry {
  readonly outcome: "retry";
  /** `Retry-After`, in seconds, when the service sent one. */
  readonly retryAfter: number | null;
}

/** `404 operation-unknown`: resubmit the identical request (C4.md §3.2). */
export interface Resubmit {
  readonly outcome: "resubmit";
}

/** A §10 outcome decided before or by the rules, or the binding's sponsorship refusal. */
export interface Rejected {
  readonly outcome: "rejected";
  readonly error: TickettoError;
}

export interface Value<T> {
  readonly outcome: "value";
  readonly value: T;
}

/** C4.md §3.1. */
export type SubmitOutcome =
  | {
      readonly outcome: "submitted";
      readonly operationId: OperationId;
      /** The submission token: what the long-poll names (§3.2). */
      readonly submission: string;
    }
  | Rejected
  | Retry
  | Defect;

/** C4.md §3.2. */
export type OperationOutcome =
  | { readonly outcome: "pending" }
  | { readonly outcome: "settled"; readonly receipt: Receipt }
  | Rejected
  | Resubmit
  | Retry
  | Defect;

/** C4.md §3.3: the SDK's `Result`, unchanged. */
export type QueryOutcome<Q extends Query> = Value<Result<QueryResult<Q>>> | Retry | Defect;

/** A log entry as C4 carries it: the signed input's bytes, not yet decoded by the profile. */
export interface WireLogEntry {
  readonly kind: "command" | "pass";
  readonly bytes: Uint8Array;
}

/** C4.md §3.4: one record, its entry still in the profile's signed-input framing. */
export interface WireLogRecord {
  readonly cursor: Cursor;
  readonly recordedAt: Timestamp;
  readonly event: { readonly id: string; readonly sequence: number } | null;
  readonly entry: WireLogEntry;
  readonly presentedAt: Timestamp | null;
}

export interface WireLogPage {
  readonly records: readonly WireLogRecord[];
  readonly next: Cursor;
}

export type LogOutcome = Value<WireLogPage> | Retry | Defect;

export type AssuranceOutcome = Value<AssuranceDeclaration> | Retry | Defect;

/** C4.md §3.7. The checkpoint's bytes are `C7`'s, and the binding does not decode them. */
export interface LatestCheckpoint {
  readonly head: Cursor;
  readonly checkpoint: { readonly cursor: Cursor; readonly bytes: Uint8Array } | null;
}

export type CheckpointOutcome = Value<LatestCheckpoint> | Retry | Defect;

/** An HTTP response, read to its end. */
export interface ReceivedResponse {
  readonly status: number;
  /** A header's value by lower-case name, or `null`. */
  header(name: string): string | null;
  readonly text: string;
}

type Body = Record<string, unknown>;

// `Array.prototype.at` is avoided: not every Hermes release React Native apps ship
// has it.
function isObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const RETRY: Retry = { outcome: "retry", retryAfter: null };

function defect(reason: string): Defect {
  return { outcome: "defect", reason };
}

/** §10 codes the service may carry: those raised by the ledger's rules (C4.md §4.1). */
export function isLedgerCode(code: unknown): code is TickettoErrorCode {
  return (
    typeof code === "string" &&
    (TICKETTO_ERROR_CODES as readonly string[]).includes(code) &&
    TICKETTO_ERROR_ORIGINS[code as TickettoErrorCode] === "ledger"
  );
}

/** A C4 outcome error (§4.1): a ledger-origin code and an optional detail, nothing else. */
function ledgerError(value: unknown): TickettoError | undefined {
  if (!isObject(value) || !isLedgerCode(value.code)) return undefined;
  if (Object.keys(value).some((key) => key !== "code" && key !== "detail")) return undefined;
  if (value.detail === undefined) return { code: value.code };
  return typeof value.detail === "string" ? { code: value.code, detail: value.detail } : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `Retry-After` in seconds (C4.md §4.2), or `null` when absent or not a delay in seconds. */
function retryAfter(response: ReceivedResponse): number | null {
  const value = response.header("retry-after")?.trim();
  return value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/**
 * The row of a non-2xx response (C4.md §4.2, §4.3). `422` is `POST /v0/submit`'s
 * alone; the other endpoint-specific codes are refused on any other endpoint.
 */
function failure(
  endpoint: Endpoint,
  response: ReceivedResponse,
): Rejected | Resubmit | Retry | Defect {
  const { status } = response;
  const body = parseJson(response.text);

  if (status === 422) {
    if (endpoint !== "POST /v0/submit") return defect(`422 from ${endpoint}`);
    const error = isObject(body) ? ledgerError(body.rejection) : undefined;
    return error === undefined
      ? defect("422 without a ledger-origin rejection")
      : { outcome: "rejected", error };
  }

  const wire = isObject(body) && isObject(body.error) ? body.error : undefined;
  if (wire === undefined || typeof wire.code !== "string") {
    // Not a C4 body. A server error from something in front of the service —
    // a proxy's 502 or 504 — is a transport failure; anything else is a defect.
    return status >= 500 && status < 600 ? RETRY : defect(`${status} without a C4 error body`);
  }
  // The table decides the row (T-007-04); a code it does not have is a defect.
  const row = translateWireCode(wire.code, status, endpoint);
  if (row === undefined) return defect(`unmapped wire code ${wire.code}`);
  const { translation } = row;
  switch (translation.row) {
    case "rejected":
      return { outcome: "rejected", error: { code: translation.code } };
    case "resubmit":
      return { outcome: "resubmit" };
    case "retry":
      return { outcome: "retry", retryAfter: retryAfter(response) };
    case "defect":
      return defect(row.reason ?? `${status} ${wire.code}`);
    default:
      return defect(`unmapped wire code ${wire.code}`);
  }
}

/** A 2xx body, or the row a non-2xx response or a wrong success status falls in. */
function success(
  endpoint: Endpoint,
  response: ReceivedResponse,
  expected: number,
): { readonly body: Body } | Rejected | Resubmit | Retry | Defect {
  if (response.status < 200 || response.status >= 300) return failure(endpoint, response);
  if (response.status !== expected) return defect(`${response.status} from ${endpoint}`);
  const body = parseJson(response.text);
  return isObject(body) ? { body } : defect(`${endpoint} answered a body that is not C4`);
}

/** C4.md §3.1. */
export function translateSubmit(response: ReceivedResponse): SubmitOutcome {
  const read = success("POST /v0/submit", response, 202);
  if (!("body" in read)) {
    return read.outcome === "resubmit" ? defect("operation-unknown from submit") : read;
  }
  const { operationId, submission } = read.body;
  if (!isOperationId(operationId) || !isSubmissionToken(submission)) {
    return defect("202 without an operation id and a submission token");
  }
  return { outcome: "submitted", operationId, submission };
}

/** C4.md §3.2, for the poll of `operationId`. */
export function translateOperation(
  response: ReceivedResponse,
  operationId: OperationId,
): OperationOutcome {
  const read = success("GET /v0/operations/{operationId}", response, 200);
  if (!("body" in read)) {
    return read.outcome === "rejected" ? defect("a poll cannot be refused at submission") : read;
  }
  const { body } = read;
  switch (body.state) {
    case "pending":
      return { outcome: "pending" };
    case "settled": {
      const receipt = body.receipt;
      if (!isObject(receipt) || !isCursor(receipt.cursor))
        return defect("settled without a receipt");
      if (receipt.operationId !== operationId) {
        return defect("settled with the receipt of another operation");
      }
      return { outcome: "settled", receipt: { operationId, cursor: receipt.cursor } };
    }
    case "rejected": {
      const error = ledgerError(body.error);
      return error === undefined
        ? defect("rejected without a ledger-origin code")
        : { outcome: "rejected", error };
    }
    default:
      return defect("a poll answered no known state");
  }
}

/** Not a submission: the rows a read can fall in. */
function readFailure(
  endpoint: Endpoint,
  read: Rejected | Resubmit | Retry | Defect,
): Retry | Defect {
  if (read.outcome === "retry" || read.outcome === "defect") return read;
  return defect(
    `${read.outcome === "rejected" ? "a rejection" : "operation-unknown"} from ${endpoint}`,
  );
}

/** C4.md §3.3. */
export function translateQuery<Q extends Query>(
  response: ReceivedResponse,
  query: Q,
): QueryOutcome<Q> {
  const read = success("POST /v0/query", response, 200);
  if (!("body" in read)) return readFailure("POST /v0/query", read);
  const result = read.body.result;
  if (!isObject(result)) return defect("a query answered no result");
  if (result.ok === false) {
    const error = ledgerError(result.error);
    return error === undefined
      ? defect("a query error without a ledger-origin code")
      : { outcome: "value", value: { ok: false, error } };
  }
  if (result.ok !== true || !Object.hasOwn(result, "value"))
    return defect("a result that is not C4");
  const value = result.value;
  // The value is the SDK's shape for the query's kind (§3.3). What decides the
  // row is checked here; the shapes themselves are the SDK's.
  switch (query.kind) {
    case "getEvent":
    case "getTicket":
      if (!isObject(value)) return defect(`${query.kind} answered no ${query.kind.slice(3)}`);
      break;
    case "canAttend":
      if (
        !isObject(value) ||
        !(value.admit === true || (value.admit === false && isLedgerCode(value.reason)))
      ) {
        return defect("canAttend answered no verdict");
      }
      break;
    case "getCancellationHolder":
      if (value !== null && !isHex(value))
        return defect("getCancellationHolder answered no account");
      break;
    case "getCredential":
      // A `Registration` travels as hex (§1.2, §3.3); the SDK's value is its bytes.
      if (value === null) break;
      if (!isHex(value) || value === "") return defect("getCredential answered no registration");
      return { outcome: "value", value: { ok: true, value: fromHex(value) as QueryResult<Q> } };
    default:
      return defect("a query of an unknown kind");
  }
  return { outcome: "value", value: { ok: true, value: value as QueryResult<Q> } };
}

function logRecord(value: unknown): WireLogRecord | undefined {
  if (!isObject(value)) return undefined;
  const { cursor, recordedAt, event, entry, presentedAt } = value;
  if (!isCursor(cursor) || !isCount(recordedAt)) return undefined;
  if (event !== null && !(isObject(event) && isHex(event.id) && isCount(event.sequence))) {
    return undefined;
  }
  if (!isObject(entry) || !isHex(entry.bytes)) return undefined;
  // §3.4: `presentedAt` is a pass's claimed time, and `null` for a command.
  let kind: WireLogEntry["kind"];
  if (entry.kind === "command" && presentedAt === null) kind = "command";
  else if (entry.kind === "pass" && isCount(presentedAt)) kind = "pass";
  else return undefined;
  return {
    cursor,
    recordedAt,
    event: event === null ? null : { id: event.id as string, sequence: event.sequence as number },
    entry: { kind, bytes: fromHex(entry.bytes) },
    presentedAt: presentedAt as Timestamp | null,
  };
}

/** C4.md §3.4, for the page read from `from` with `limit`. */
export function translateLog(response: ReceivedResponse, from: Cursor, limit: number): LogOutcome {
  const read = success("GET /v0/log", response, 200);
  if (!("body" in read)) return readFailure("GET /v0/log", read);
  const { records, next } = read.body;
  if (!Array.isArray(records) || !isCursor(next)) return defect("a log page that is not C4");
  if (records.length > limit) return defect("a log page longer than its limit");
  const page: WireLogRecord[] = [];
  for (const record of records) {
    const parsed = logRecord(record);
    if (parsed === undefined) return defect("a log record that is not C4");
    page.push(parsed);
  }
  // `next` is the last record's cursor, or `from` when there are none (`LogPage`).
  if (next !== (page[page.length - 1]?.cursor ?? from))
    return defect("a log page whose next is not its last");
  return { outcome: "value", value: { records: page, next } };
}

/** C4.md §3.6: exactly one entry per invariant id the SDK generates, and no other keys. */
export function translateAssurance(response: ReceivedResponse): AssuranceOutcome {
  const read = success("GET /v0/assurance", response, 200);
  if (!("body" in read)) return readFailure("GET /v0/assurance", read);
  const assurance = read.body.assurance;
  if (!isObject(assurance)) return defect("no assurance declaration");
  const keys = Object.keys(assurance);
  const complete =
    keys.length === INVARIANT_IDS.length &&
    INVARIANT_IDS.every((id) => assurance[id] === "enforced" || assurance[id] === "attested");
  if (!complete) return defect("an assurance declaration that is not the SDK's");
  const declaration = Object.fromEntries(INVARIANT_IDS.map((id) => [id, assurance[id]]));
  return { outcome: "value", value: declaration as AssuranceDeclaration };
}

/** C4.md §3.7. */
export function translateCheckpoint(response: ReceivedResponse): CheckpointOutcome {
  const read = success("GET /v0/checkpoints/latest", response, 200);
  if (!("body" in read)) return readFailure("GET /v0/checkpoints/latest", read);
  const { head, checkpoint } = read.body;
  if (!isCursor(head)) return defect("a checkpoint answer without a head");
  if (checkpoint === null) return { outcome: "value", value: { head, checkpoint: null } };
  if (!isObject(checkpoint) || !isCursor(checkpoint.cursor) || !isHex(checkpoint.bytes)) {
    return defect("a checkpoint that is not C4");
  }
  return {
    outcome: "value",
    value: { head, checkpoint: { cursor: checkpoint.cursor, bytes: fromHex(checkpoint.bytes) } },
  };
}

/** C4.md §3.5: the response that opens a hint stream, before any hint is read. */
export function translateHintsResponse(
  response: ReceivedResponse,
): { readonly outcome: "hints" } | Retry | Defect {
  if (response.status < 200 || response.status >= 300) {
    return readFailure("GET /v0/log/hints", failure("GET /v0/log/hints", response));
  }
  if (response.status !== 200) return defect(`${response.status} from GET /v0/log/hints`);
  const type = response.header("content-type") ?? "";
  if (!/^text\/event-stream\s*(?:;|$)/i.test(type))
    return defect("hints that are not an event stream");
  return { outcome: "hints" };
}
