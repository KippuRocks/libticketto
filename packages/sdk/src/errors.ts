// Errors and results — features/002-sdk/plan.md §5.3, AD-14.
//
// Results are values. Every error a caller can receive is one of SPEC.md §10's,
// by name; the codes are generated from the spec, so the surface cannot quietly
// disagree with it, and a backend's own errors can never pass through
// untranslated (REQ-SDK-2).

import type { TickettoErrorCode } from "./generated/spec.js";

/** An error of SPEC.md §10. */
export interface TickettoError {
  readonly code: TickettoErrorCode;
  /** Human-readable context. Never carries a backend concept (`REQ-SDK-2`). */
  readonly detail?: string;
}

/** The outcome of an operation: a value, or an error of SPEC.md §10. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TickettoError };
