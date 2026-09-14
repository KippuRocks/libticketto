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
