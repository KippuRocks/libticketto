// Result helpers over the SDK's `Result` (features/002-sdk/plan.md §5.3).

import type { Result, TickettoError, TickettoErrorCode } from "@ticketto/sdk";

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function error(code: TickettoErrorCode, detail?: string): TickettoError {
  return detail === undefined ? { code } : { code, detail };
}

export function err<T = never>(code: TickettoErrorCode, detail?: string): Result<T> {
  return { ok: false, error: error(code, detail) };
}

/** Whether two byte strings are equal. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
