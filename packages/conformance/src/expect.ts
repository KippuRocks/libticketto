// Assertions over results — AD-14: outcomes are values, so a rejection is
// asserted by its §10 code and never by a thrown error.

import type { Result, TickettoErrorCode } from "@ticketto/sdk";
import { expect } from "vitest";

/** Asserts that a write settled, or a query answered, and returns its value. */
export async function expectOk<T>(pending: PromiseLike<Result<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) {
    return expect.fail(`expected success, but got ${result.error.code}`);
  }
  return result.value;
}

/** Asserts that a write was rejected, or a query refused, with `code`. */
export async function expectError<T>(
  pending: PromiseLike<Result<T>>,
  code: TickettoErrorCode,
): Promise<void> {
  const result = await pending;
  if (result.ok) {
    expect.fail(`expected ${code}, but it succeeded`);
  }
  expect(result.error.code, `expected ${code}, but got ${result.error.code}`).toBe(code);
}
