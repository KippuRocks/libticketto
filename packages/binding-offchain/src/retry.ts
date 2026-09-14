// Retry, and the unavailability rejection — T-007-07; F-007 §5; amendment 0003 G8.
//
// Every C4 exchange that falls on a retry row (C4.md §4.3) — a transport
// failure, a timeout, `503 unavailable`, a `5xx` without a C4 body — and every
// resubmission is counted against one budget. Each retry waits an exponential
// backoff, never less than the service's `Retry-After`. Progress — an answer that
// is not a retry row — refills the budget. When it is spent, the ledger could not
// be reached: the binding reports `ERR-LedgerUnavailable`, with no detail, since
// whatever failed underneath is a backend concept (REQ-SDK-2).

import type { TickettoError } from "@ticketto/sdk";
import type { AbortSignalLike } from "./client.js";
import type { Retry } from "./translate.js";
import { UNAVAILABLE_CODE } from "./translation.js";

/** How transient failures are retried. */
export interface RetryPolicy {
  /** Consecutive failed exchanges retried before the budget is spent. */
  readonly attempts: number;
  /** The first backoff, in milliseconds; each further one doubles. */
  readonly initialDelay: number;
  /** The longest backoff, in milliseconds. `Retry-After` may ask for longer, and is honoured. */
  readonly maxDelay: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 8, initialDelay: 250, maxDelay: 10_000 };

/** The timers the binding waits with. Defaults to the platform's. */
export interface Timers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the binding reports once the budget is spent: G8's code, and nothing else. */
export const LEDGER_UNAVAILABLE: TickettoError = Object.freeze({ code: UNAVAILABLE_CODE });

/** An exchange abandoned at its timeout. */
export const TIMED_OUT = Symbol("timed out");

export interface RetryOptions {
  readonly retry?: Partial<RetryPolicy>;
  readonly timers?: Timers;
}

function platformTimers(): Timers {
  const scope = globalThis as unknown as {
    setTimeout?: (callback: () => void, milliseconds: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  const { setTimeout, clearTimeout } = scope;
  if (setTimeout === undefined || clearTimeout === undefined) {
    throw new Error("this platform has no timers; pass them in the binding's options");
  }
  return {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle),
  };
}

interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(): void;
}

function abortController(): AbortControllerLike | undefined {
  const Controller = (globalThis as unknown as { AbortController?: new () => AbortControllerLike })
    .AbortController;
  return Controller === undefined ? undefined : new Controller();
}

/** One operation's budget: a submission with its polls, or one read. */
export interface RetryBudget {
  /** An exchange made progress: the budget is whole again. */
  progress(): void;
  /**
   * Counts a failed exchange. Waits the backoff when `delay` is set, and resolves
   * `true` to retry — or `false` once the budget is spent, when the caller
   * reports `LEDGER_UNAVAILABLE`.
   */
  spend(retryAfter: number | null, delay: boolean): Promise<boolean>;
}

export interface Retrier {
  readonly policy: RetryPolicy;
  budget(): RetryBudget;
  /** The backoff before retry `attempt` (1-based), never less than `Retry-After` seconds. */
  delay(attempt: number, retryAfter: number | null): number;
  /** Waits `milliseconds` on the retrier's timers. */
  sleep(milliseconds: number): Promise<void>;
  /** Runs one exchange, abandoning it after `milliseconds`: an abandoned exchange is a transport failure. */
  timed<T>(
    exchange: (signal: AbortSignalLike | undefined) => Promise<T>,
    milliseconds: number,
  ): Promise<T | typeof TIMED_OUT>;
  /**
   * Repeats a side-effect-free exchange while it falls on a retry row or times
   * out, and resolves its first other outcome — or `LEDGER_UNAVAILABLE` once the
   * budget is spent. Every read in C4 may be retried freely (C4.md §4.3).
   */
  read<T extends { readonly outcome: string }>(
    exchange: (signal: AbortSignalLike | undefined) => Promise<T | Retry>,
    milliseconds: number,
  ): Promise<
    Exclude<T, Retry> | { readonly outcome: "unavailable"; readonly error: TickettoError }
  >;
}

export function createRetrier(options: RetryOptions = {}): Retrier {
  const policy: RetryPolicy = { ...DEFAULT_RETRY, ...options.retry };
  if (!Number.isSafeInteger(policy.attempts) || policy.attempts < 0) {
    throw new RangeError("retry attempts is a non-negative integer");
  }
  const timers = options.timers ?? platformTimers();

  const sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      timers.setTimeout(resolve, milliseconds);
    });

  /** The delay before retry `attempt` (1-based), honouring `Retry-After`. */
  const backoff = (attempt: number, retryAfter: number | null): number => {
    const exponential = Math.min(policy.maxDelay, policy.initialDelay * 2 ** (attempt - 1));
    return Math.max(exponential, retryAfter === null ? 0 : retryAfter * 1000);
  };

  const budget = (): RetryBudget => {
    let failures = 0;
    return {
      progress() {
        failures = 0;
      },
      async spend(retryAfter, delay) {
        failures += 1;
        if (failures > policy.attempts) return false;
        if (delay) await sleep(backoff(failures, retryAfter));
        return true;
      },
    };
  };

  const timed: Retrier["timed"] = async (exchange, milliseconds) => {
    const controller = abortController();
    let timedOut = false;
    let handle: unknown;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      handle = timers.setTimeout(() => {
        timedOut = true;
        controller?.abort();
        resolve(TIMED_OUT);
      }, milliseconds);
    });
    try {
      return await Promise.race([exchange(controller?.signal), timeout]);
    } catch (error) {
      if (timedOut) return TIMED_OUT;
      throw error;
    } finally {
      timers.clearTimeout(handle);
    }
  };

  const read: Retrier["read"] = async (exchange, milliseconds) => {
    const readBudget = budget();
    for (;;) {
      const outcome = await timed(exchange, milliseconds);
      const retryAfter =
        outcome === TIMED_OUT
          ? null
          : outcome.outcome === "retry"
            ? (outcome as Retry).retryAfter
            : undefined;
      if (retryAfter === undefined) return outcome as never;
      if (!(await readBudget.spend(retryAfter, true))) {
        return { outcome: "unavailable", error: LEDGER_UNAVAILABLE };
      }
    }
  };

  return { policy, budget, delay: backoff, sleep, timed, read };
}
