// C4 requests — protocol/C4.md in KippuRocks/ticketto-offchain (T-010-02).
//
// Each builder produces the request C4 defines for one endpoint, exactly as it
// goes on the wire, and refuses to build one the service would answer with
// `malformed` (C4.md §4.2): a request the binding sends is C4, or it is not sent.

import type { Cursor, OperationId, Query, Timestamp } from "@ticketto/sdk";
import { toHex } from "./hex.js";

/** A JSON value, as C4 bodies carry them. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** C4.md §2. */
export const ENDPOINTS = [
  "POST /v0/submit",
  "GET /v0/operations/{operationId}",
  "POST /v0/query",
  "GET /v0/log",
  "GET /v0/log/hints",
  "GET /v0/assurance",
  "GET /v0/checkpoints/latest",
] as const;

export type Endpoint = (typeof ENDPOINTS)[number];

/** One HTTP request, as C4's vectors record it. */
export interface WireRequest {
  readonly method: "GET" | "POST";
  /** The path with its query string, exactly as sent. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** A JSON body, before serialisation. */
  readonly body?: Json;
}

/** C4.md §1.2: the only request content type the service accepts. */
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** C4.md §1.2: the largest request body the service accepts. */
export const MAX_BODY_BYTES = 256 * 1024;

/** C4.md §3.2: bounds and default of a long-poll's `wait`, in milliseconds. */
export const WAIT_MAX = 30_000;
export const WAIT_DEFAULT = 25_000;

/** C4.md §3.4: bounds of a log page's `limit`. */
export const LIMIT_MAX = 1_000;

/**
 * A signed input in the profile's signed-input framing (C4.md §1.3), and for a
 * pass the time the gate observed it (§3.1). C4 carries these bytes and never
 * re-encodes them.
 */
export type SignedInputBytes =
  | { readonly kind: "command"; readonly bytes: Uint8Array }
  | { readonly kind: "pass"; readonly bytes: Uint8Array; readonly presentedAt: Timestamp };

const CURSOR = /^[A-Za-z0-9._~-]{0,128}$/;
const TOKEN = /^[A-Za-z0-9._~-]{1,128}$/;
const IDENTIFIER_32 = /^[0-9a-f]{64}$/;
const OPERATION_ID = /^(?:[0-9a-f]{2})+$/;

/** C4.md §1.4: a cursor on the wire. The empty string is `LOG_START`. */
export function isCursor(value: unknown): value is Cursor {
  return typeof value === "string" && CURSOR.test(value);
}

/** C4.md §1.4: a submission token. */
export function isSubmissionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

/** An operation id, or a pass id: the profile's canonical bytes as lower-case hex. */
export function isOperationId(value: unknown): value is OperationId {
  return typeof value === "string" && OPERATION_ID.test(value);
}

/** C4.md §1.2: `Timestamp` and `Count` are non-negative safe integers. */
export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function refuse(message: string): never {
  throw new TypeError(`not a C4 request: ${message}`);
}

/** C4.md §3.1. */
export function submitRequest(
  input: SignedInputBytes,
  sponsorship: Uint8Array | null,
): WireRequest {
  if (!(input.bytes instanceof Uint8Array)) refuse("input bytes are not bytes");
  if (sponsorship !== null && !(sponsorship instanceof Uint8Array)) {
    refuse("sponsorship is not bytes");
  }
  const signedInput = { kind: input.kind, bytes: toHex(input.bytes) };
  const sponsorshipHex = sponsorship === null ? null : toHex(sponsorship);
  let body: Json;
  if (input.kind === "command") {
    if ("presentedAt" in input) refuse("presentedAt is only for a pass");
    body = { input: signedInput, sponsorship: sponsorshipHex };
  } else if (input.kind === "pass") {
    if (!isCount(input.presentedAt)) refuse("presentedAt is required for a pass");
    body = { input: signedInput, sponsorship: sponsorshipHex, presentedAt: input.presentedAt };
  } else {
    refuse("input kind is neither command nor pass");
  }
  // C4.md §1.2: a body over 256 KiB is `413 malformed`. Hex and JSON are ASCII,
  // so the serialised length is the byte length.
  if (JSON.stringify(body).length > MAX_BODY_BYTES) refuse("the body exceeds 256 KiB");
  return {
    method: "POST",
    path: "/v0/submit",
    headers: { "content-type": JSON_CONTENT_TYPE },
    body,
  };
}

/** C4.md §3.2. Without `wait`, the service holds the request for its default. */
export function operationRequest(
  operationId: OperationId,
  submission: string,
  wait?: number,
): WireRequest {
  if (!isOperationId(operationId)) refuse("operationId is not an operation id");
  if (!isSubmissionToken(submission)) refuse("submission is not a submission token");
  let path = `/v0/operations/${operationId}?submission=${submission}`;
  if (wait !== undefined) {
    if (!Number.isSafeInteger(wait) || wait < 0 || wait > WAIT_MAX) {
      refuse(`wait is 0 to ${WAIT_MAX}`);
    }
    path += `&wait=${wait}`;
  }
  return { method: "GET", path };
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_32.test(value)) {
    refuse(`${name} is not a 32-byte identifier`);
  }
  return value;
}

/**
 * C4.md §3.3. The body is the SDK's `Query`, with exactly the fields of its
 * kind: the service refuses a field it does not know (§1.1). C4 version 0
 * defines four kinds; any other SDK query — `getCredential` among them — has no
 * C4 request, and is refused rather than sent.
 */
export function queryRequest(query: Query): WireRequest {
  let body: Json;
  switch (query.kind) {
    case "getEvent":
      body = { kind: query.kind, event: identifier(query.event, "event") };
      break;
    case "getTicket":
      body = { kind: query.kind, ticket: identifier(query.ticket, "ticket") };
      break;
    case "canAttend":
      body = {
        kind: query.kind,
        event: identifier(query.event, "event"),
        ticket: identifier(query.ticket, "ticket"),
      };
      break;
    case "getCancellationHolder":
      body = { kind: query.kind, ticket: identifier(query.ticket, "ticket") };
      break;
    default:
      refuse(`unknown query kind ${String((query as { kind?: unknown }).kind)}`);
  }
  return {
    method: "POST",
    path: "/v0/query",
    headers: { "content-type": JSON_CONTENT_TYPE },
    body,
  };
}

/** C4.md §3.4. */
export function logRequest(from: Cursor, limit: number): WireRequest {
  if (!isCursor(from)) refuse("from is not a cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT_MAX) {
    refuse(`limit is 1 to ${LIMIT_MAX}`);
  }
  return { method: "GET", path: `/v0/log?from=${from}&limit=${limit}` };
}

/** C4.md §3.5. */
export function hintsRequest(): WireRequest {
  return { method: "GET", path: "/v0/log/hints", headers: { accept: "text/event-stream" } };
}

/** C4.md §3.6. */
export function assuranceRequest(): WireRequest {
  return { method: "GET", path: "/v0/assurance" };
}

/** C4.md §3.7. */
export function latestCheckpointRequest(): WireRequest {
  return { method: "GET", path: "/v0/checkpoints/latest" };
}
