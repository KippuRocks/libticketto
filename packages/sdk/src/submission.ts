// Write completion — features/002-sdk/plan.md §5.8, AD-14.
//
// Backends differ in write latency by orders of magnitude (NFR-9). A
// `Submission` presents a 1 ms backend and a 60 s backend identically: it can
// be awaited for its result, or iterated through `submitted → settled |
// rejected`, and an iterator that starts late sees every state from the
// beginning, so no caller has to race the backend.

import type { Result, TickettoError } from "./errors.js";
import type { OperationId } from "./identifiers.js";
import type { Cursor } from "./log.js";

/**
 * What a backend returns once a write is recorded.
 *
 * For an access pass, the pass id serves as the operation id: like an event's
 * or a ticket's derived id, it already identifies the write (`AD-15`, `AD-13`).
 */
export interface Receipt {
  readonly operationId: OperationId;
  /**
   * The log cursor of the record this write produced: once a reader of the log
   * has read it, the reader reflects the write (`NFR-11`).
   */
  readonly cursor: Cursor;
}

/** One step of a write's completion. */
export type SubmissionState =
  | { readonly state: "submitted"; readonly operationId: OperationId }
  | { readonly state: "settled"; readonly receipt: Receipt }
  | { readonly state: "rejected"; readonly error: TickettoError };

/** A write in flight: awaitable for its result, and iterable through its states. */
export interface Submission<T> extends PromiseLike<Result<T>>, AsyncIterable<SubmissionState> {}

/** Drives a `Submission` from inside a backend or a client. */
export interface SubmissionController {
  readonly submission: Submission<Receipt>;
  /** The backend accepted the write for recording. At most once, and before it ends. */
  submitted(operationId: OperationId): void;
  /** The write was recorded. Implies `submitted` if that was never reported. Ends the submission. */
  settled(receipt: Receipt): void;
  /** The write was refused with an error of §10. Ends the submission. */
  rejected(error: TickettoError): void;
  /**
   * Something outside §10 failed — a signer threw, say. Ends the submission:
   * awaiting it rejects with `reason`, and iterating it throws `reason`.
   */
  failed(reason: unknown): void;
}

/** A new, pending submission and the controller that completes it. */
export function createSubmission(): SubmissionController {
  const states: SubmissionState[] = [];
  let ended = false;
  let failure: { readonly reason: unknown } | undefined;
  let wake: (() => void)[] = [];
  let resolve!: (result: Result<Receipt>) => void;
  let reject!: (reason: unknown) => void;
  const outcome = new Promise<Result<Receipt>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A failure nobody awaits must not surface as an unhandled rejection.
  outcome.catch(() => {});

  const notify = () => {
    const waiting = wake;
    wake = [];
    for (const w of waiting) w();
  };
  const assertOpen = (step: string) => {
    if (ended) throw new Error(`Submission already ended; cannot report ${step}`);
  };
  const push = (state: SubmissionState) => {
    states.push(state);
    notify();
  };

  const submission: Submission<Receipt> = {
    // biome-ignore lint/suspicious/noThenProperty: a Submission is deliberately PromiseLike (AD-14).
    then(onfulfilled, onrejected) {
      return outcome.then(onfulfilled, onrejected);
    },
    [Symbol.asyncIterator]() {
      let index = 0;
      let done = false;
      return {
        async next(): Promise<IteratorResult<SubmissionState>> {
          while (!done) {
            const state = states[index];
            if (state !== undefined) {
              index += 1;
              return { done: false, value: state };
            }
            if (ended) {
              done = true;
              if (failure !== undefined) throw failure.reason;
              break;
            }
            await new Promise<void>((w) => wake.push(w));
          }
          return { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<SubmissionState>> {
          done = true;
          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    submission,
    submitted(operationId) {
      assertOpen("submitted");
      if (states.length > 0) throw new Error("Submission already reported submitted");
      push({ state: "submitted", operationId });
    },
    settled(receipt) {
      assertOpen("settled");
      if (states.length === 0) push({ state: "submitted", operationId: receipt.operationId });
      ended = true;
      push({ state: "settled", receipt });
      resolve({ ok: true, value: receipt });
    },
    rejected(error) {
      assertOpen("rejected");
      ended = true;
      push({ state: "rejected", error });
      resolve({ ok: false, error });
    },
    failed(reason) {
      assertOpen("failed");
      ended = true;
      failure = { reason };
      notify();
      reject(reason);
    },
  };
}
