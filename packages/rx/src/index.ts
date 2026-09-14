// @ticketto/rx — an optional RxJS adapter over the SDK surface.
// Design: features/002-sdk/plan.md §5.10 in KippuRocks/kippu-docs; AD-14.
//
// The SDK's `Submission` is awaitable and async-iterable, with no dependency.
// This package presents the same completion as an `Observable` for apps that
// want RxJS, so RxJS identity is never a correctness requirement of the SDK:
// RxJS is this package's peer dependency, never the SDK's.
//
// Both adapters read through the SDK's own async iterators, and add no state of
// their own. A subscriber therefore observes exactly what an iterating caller
// does — every state from the beginning, however late it subscribes — and a
// 1 ms and a 60 s backend look the same through it (NFR-9).

import type { Cursor, LogReader, Submission, SubmissionState } from "@ticketto/sdk";
import { Observable } from "rxjs";

/**
 * Emits each step of `iterable`'s iteration, completing when it ends and
 * erroring with whatever it throws. Every subscription iterates afresh, and
 * unsubscribing ends that iteration.
 */
function fromAsyncIterable<T>(iterable: () => AsyncIterable<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const iterator = iterable()[Symbol.asyncIterator]();
    let closed = false;

    void (async () => {
      try {
        while (!closed) {
          const step = await iterator.next();
          if (closed) return;
          if (step.done === true) {
            subscriber.complete();
            return;
          }
          subscriber.next(step.value);
        }
      } catch (reason) {
        if (!closed) subscriber.error(reason);
      }
    })();

    return () => {
      closed = true;
      // An iterator left pending would otherwise hold its source open. Its
      // completion carries nothing this subscriber still wants.
      iterator.return?.().catch(() => {});
    };
  });
}

/**
 * A write's completion as an `Observable`: `submitted`, then `settled` or
 * `rejected`, then complete.
 *
 * It emits the same states, in the same order, as iterating the submission,
 * and ends as awaiting it does: a `rejected` §10 outcome is a value, emitted
 * and followed by completion, exactly as awaiting yields `{ ok: false }`. Only a
 * failure outside §10 — a signer that threw, a defect — errors the Observable,
 * with the same reason awaiting rejects with.
 */
export function fromSubmission<T>(submission: Submission<T>): Observable<SubmissionState> {
  return fromAsyncIterable(() => submission);
}

/**
 * A log reader's hints as an `Observable` of cursors (`AD-17`).
 *
 * A hint carries a cursor and never a record: on each one, pull from the log
 * with `read`. Each subscription opens its own `hints()` stream, and
 * unsubscribing closes it. A lost hint costs latency, never data.
 */
export function fromHints(log: Pick<LogReader, "hints">): Observable<Cursor> {
  return fromAsyncIterable(() => log.hints());
}

export const packageName = "@ticketto/rx";
