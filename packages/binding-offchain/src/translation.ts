// The error translation table — T-007-04; C4.md §4.2, §4.3; REQ-SDK-2.
//
// Every wire code C4 defines, with the statuses it may come with, the endpoints
// that may send it, and what the binding does with it. The response classifier
// reads nothing but this table, so a wire code without a row cannot be acted on:
// it is a defect, and the suites fail on it. Wire codes never reach the SDK
// surface as themselves; the only §10 codes this table produces are the binding's
// own (SPEC.md §10, "Errors by where they arise").

import type { TickettoErrorCode } from "@ticketto/sdk";
import { ENDPOINTS, type Endpoint } from "./wire.js";

/** What the binding does with a wire code (C4.md §4.3). */
export type WireRow =
  /** Never retried, never mapped: a submission fails, a read throws. */
  | { readonly row: "defect" }
  /** Retry with backoff, no sooner than `Retry-After`; once the budget is spent, `ERR-LedgerUnavailable`. */
  | { readonly row: "retry" }
  /** Resubmit the identical request; counts against the retry budget. */
  | { readonly row: "resubmit" }
  /** Reject with this §10 code. */
  | { readonly row: "rejected"; readonly code: TickettoErrorCode };

export interface WireTranslation {
  /** The statuses C4.md §4.2 sends the code with. Any other status is a defect. */
  readonly statuses: readonly number[];
  /** The endpoints that may send it. From any other endpoint, a defect. */
  readonly endpoints: readonly Endpoint[];
  readonly translation: WireRow;
}

const ANY: readonly Endpoint[] = ENDPOINTS;
const DEFECT: WireRow = { row: "defect" };

/** C4.md §4.2 and §4.3, one row per wire code. */
export const WIRE_TRANSLATION = {
  malformed: { statuses: [400, 413], endpoints: ANY, translation: DEFECT },
  "not-found": { statuses: [404], endpoints: ANY, translation: DEFECT },
  "operation-unknown": {
    statuses: [404],
    endpoints: ["GET /v0/operations/{operationId}"],
    translation: { row: "resubmit" },
  },
  "cursor-unknown": { statuses: [404], endpoints: ["GET /v0/log"], translation: DEFECT },
  "sponsorship-missing": {
    statuses: [403],
    endpoints: ["POST /v0/submit"],
    translation: { row: "rejected", code: "ERR-SponsorshipRefused" },
  },
  "sponsorship-invalid": {
    statuses: [403],
    endpoints: ["POST /v0/submit"],
    translation: { row: "rejected", code: "ERR-SponsorshipRefused" },
  },
  unavailable: { statuses: [503], endpoints: ANY, translation: { row: "retry" } },
} as const satisfies Record<string, WireTranslation>;

export type WireCode = keyof typeof WIRE_TRANSLATION;

/** C4.md §4.2: every wire code, with the statuses it may be sent with. */
export const WIRE_CODES: { readonly [Code in WireCode]: readonly number[] } = Object.fromEntries(
  Object.entries(WIRE_TRANSLATION).map(([code, entry]) => [code, entry.statuses]),
) as unknown as { readonly [Code in WireCode]: readonly number[] };

/**
 * The §10 code the binding raises when the ledger cannot be reached — a spent
 * retry budget (amendment 0003 G8). It never appears on the wire.
 */
export const UNAVAILABLE_CODE = "ERR-LedgerUnavailable" satisfies TickettoErrorCode;

/** The row of `code` sent with `status` by `endpoint`; `undefined` for a code the table does not have. */
export function translateWireCode(
  code: string,
  status: number,
  endpoint: Endpoint,
): { readonly translation: WireRow; readonly reason?: string } | undefined {
  if (!Object.hasOwn(WIRE_TRANSLATION, code)) return undefined;
  const entry: WireTranslation = WIRE_TRANSLATION[code as WireCode];
  if (!entry.statuses.includes(status)) {
    return { translation: DEFECT, reason: `wire code ${code} with status ${status}` };
  }
  if (!entry.endpoints.includes(endpoint)) {
    return { translation: DEFECT, reason: `wire code ${code} from ${endpoint}` };
  }
  return entry.translation.row === "defect"
    ? { translation: DEFECT, reason: `${status} ${code}` }
    : { translation: entry.translation };
}

/**
 * Every §10 code the binding itself raises, rather than passing through from
 * the ledger. Each must be binding-origin; the suites check it.
 */
export function codesRaisedByBinding(): TickettoErrorCode[] {
  const codes = new Set<TickettoErrorCode>([UNAVAILABLE_CODE]);
  for (const entry of Object.values(WIRE_TRANSLATION) as WireTranslation[]) {
    if (entry.translation.row === "rejected") codes.add(entry.translation.code);
  }
  return [...codes];
}
