// `Backend.submit` over C4 — T-007-02; features/007-binding-offchain/plan.md §5.
//
// A submission is sent once, reported `submitted` on the service's `202`, and
// then long-polled until it settles or is rejected (C4.md §3.1, §3.2). Anything
// transient — a dropped connection, a timeout, `503`, a proxy's `5xx` — is
// retried with exponential backoff, and every retry of the submission resends
// the very request first sent, field for field. The service identifies a
// submission by those bytes, so however many times the request reaches it, the
// input reaches the rules once (REQ-CM-1). Long-polling tolerates any write
// latency: a `pending` answer is progress, not failure (NFR-9).
//
// The signed input is framed with the profile's own encoder (F-003 §5: the
// signed-input framing is the profile's, and the wire protocol uses it). The
// binding encodes; it never decodes a signed input to submit it.

import { encodeSignedAccessPass, encodeSignedCommand } from "@ticketto/profile-v0";
import {
  createSubmission,
  type OperationId,
  type Receipt,
  type Sponsorship,
  type Submission,
  type SubmissionController,
  type SubmitInput,
} from "@ticketto/sdk";
import type { AbortSignalLike, C4Client } from "./client.js";
import type { OperationOutcome, SubmitOutcome } from "./translate.js";
import { UNAVAILABLE_CODE } from "./translation.js";
import { type SignedInputBytes, WAIT_DEFAULT, WAIT_MAX } from "./wire.js";

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

export interface OffchainSubmitOptions {
  readonly client: C4Client;
  readonly retry?: Partial<RetryPolicy>;
  /** How long the service may hold each long-poll, in milliseconds (C4.md §3.2). Defaults to C4's default. */
  readonly wait?: number;
  /**
   * How long a submit request may take, and how much longer than `wait` a poll
   * may take, before either is abandoned and retried (C4.md §3.2: at least 10 s).
   */
  readonly timeoutMargin?: number;
  readonly timers?: Timers;
}

/** A response the binding cannot act on (C4.md §4.3). Fails the submission; never retried. */
export class C4Defect extends Error {
  constructor(reason: string) {
    super(`C4 protocol defect: ${reason}`);
    this.name = "C4Defect";
  }
}

const TIMED_OUT = Symbol("timed out");

function platformTimers(): Timers {
  const scope = globalThis as unknown as {
    setTimeout?: (callback: () => void, milliseconds: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  const { setTimeout, clearTimeout } = scope;
  if (setTimeout === undefined || clearTimeout === undefined) {
    throw new Error("this platform has no timers; pass them to createOffchainSubmit");
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

/** The operation id C4 reports for an input: a command's own, or a pass's id (`AD-15`). */
function operationIdOf(input: SubmitInput): OperationId {
  return input.kind === "command"
    ? input.signed.command.operationId
    : (input.signed.pass.id as string as OperationId);
}

/** The signed input in the profile's framing, as C4 carries it (C4.md §1.3). */
function signedInputBytes(input: SubmitInput): SignedInputBytes {
  switch (input.kind) {
    case "command":
      return { kind: "command", bytes: encodeSignedCommand(input.signed) };
    case "pass":
      return {
        kind: "pass",
        bytes: encodeSignedAccessPass(input.signed),
        presentedAt: input.presentedAt,
      };
    default:
      throw new TypeError("a submission is a command or a pass");
  }
}

export function createOffchainSubmit(
  options: OffchainSubmitOptions,
): (input: SubmitInput, sponsorship?: Sponsorship) => Submission<Receipt> {
  const { client } = options;
  const retry: RetryPolicy = { ...DEFAULT_RETRY, ...options.retry };
  const wait = options.wait ?? WAIT_DEFAULT;
  if (!Number.isSafeInteger(wait) || wait < 0 || wait > WAIT_MAX) {
    throw new RangeError(`wait is 0 to ${WAIT_MAX}`);
  }
  const margin = options.timeoutMargin ?? 10_000;
  const timers = options.timers ?? platformTimers();

  const sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      timers.setTimeout(resolve, milliseconds);
    });

  /** Runs one exchange, abandoning it after `milliseconds`: an abandoned exchange is a transport failure. */
  async function timed<T>(
    exchange: (signal: AbortSignalLike | undefined) => Promise<T>,
    milliseconds: number,
  ): Promise<T | typeof TIMED_OUT> {
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
  }

  /** The delay before retry `attempt` (1-based), honouring `Retry-After`. */
  function backoff(attempt: number, retryAfter: number | null): number {
    const exponential = Math.min(retry.maxDelay, retry.initialDelay * 2 ** (attempt - 1));
    return Math.max(exponential, retryAfter === null ? 0 : retryAfter * 1000);
  }

  async function run(
    input: SubmitInput,
    sponsorship: Sponsorship | undefined,
    controller: SubmissionController,
  ): Promise<void> {
    const expected = operationIdOf(input);
    // Built once: every resubmission sends exactly these bytes (REQ-CM-1).
    const request = signedInputBytes(input);
    const sponsorshipBytes = sponsorship ?? null;
    let reported = false;
    let token: string | undefined;
    let failures = 0;

    /** Counts a failed exchange against the budget; `false` once it is spent. */
    const spend = async (retryAfter: number | null, delay: boolean): Promise<boolean> => {
      failures += 1;
      if (failures > retry.attempts) {
        // Amendment 0003 G8: the ledger could not be reached.
        controller.rejected({ code: UNAVAILABLE_CODE });
        return false;
      }
      if (delay) await sleep(backoff(failures, retryAfter));
      return true;
    };

    for (;;) {
      if (token === undefined) {
        const outcome: SubmitOutcome | typeof TIMED_OUT = await timed(
          (signal) =>
            client.submit(request, sponsorshipBytes, signal === undefined ? {} : { signal }),
          margin,
        );
        if (outcome === TIMED_OUT) {
          if (!(await spend(null, true))) return;
          continue;
        }
        switch (outcome.outcome) {
          case "submitted":
            if (outcome.operationId !== expected) {
              controller.failed(new C4Defect("accepted under another operation id"));
              return;
            }
            // Not progress by itself: a service that accepts and then forgets
            // must still spend the budget (see `resubmit`).
            token = outcome.submission;
            if (!reported) {
              reported = true;
              controller.submitted(expected);
            }
            break;
          case "rejected":
            controller.rejected(outcome.error);
            return;
          case "retry":
            if (!(await spend(outcome.retryAfter, true))) return;
            break;
          case "defect":
            controller.failed(new C4Defect(outcome.reason));
            return;
          default:
            controller.failed(new C4Defect("an unmapped submit outcome"));
            return;
        }
        continue;
      }

      const submission = token;
      const outcome: OperationOutcome | typeof TIMED_OUT = await timed(
        (signal) =>
          client.operation(
            expected,
            submission,
            signal === undefined ? { wait } : { wait, signal },
          ),
        wait + margin,
      );
      if (outcome === TIMED_OUT) {
        // A poll is a read: repeating it changes nothing (C4.md §3.2).
        if (!(await spend(null, true))) return;
        continue;
      }
      switch (outcome.outcome) {
        case "pending":
          failures = 0;
          break;
        case "settled":
          controller.settled(outcome.receipt);
          return;
        case "rejected":
          controller.rejected(outcome.error);
          return;
        case "resubmit":
          // The service holds no outcome for this token: resend the identical
          // request. It counts against the budget (C4.md §4.3).
          token = undefined;
          if (!(await spend(null, false))) return;
          break;
        case "retry":
          if (!(await spend(outcome.retryAfter, true))) return;
          break;
        case "defect":
          controller.failed(new C4Defect(outcome.reason));
          return;
        default:
          controller.failed(new C4Defect("an unmapped poll outcome"));
          return;
      }
    }
  }

  return (input, sponsorship) => {
    const controller = createSubmission();
    run(input, sponsorship, controller).catch((error: unknown) => {
      try {
        controller.failed(error);
      } catch {
        // Already ended: the error came after the outcome was reported.
      }
    });
    return controller.submission;
  };
}
