// The log reader, with hints — T-005-03, features/005-backend-memory/plan.md §2,
// REQ-SDK-5, AD-17.
//
// Reading by cursor is authoritative. Hints only say when to read: they carry
// cursors, never records, and a reader that misses one loses latency, never
// data. They behave as the hosted service's hint stream does (C4 §3.5), so a
// reader written against one backend works against the other: the current head
// first, then the latest head after each commit that moves it, coalesced while
// the reader is not waiting.

import { type Cursor, LOG_START, type LogPage, type LogReader, type Result } from "@ticketto/sdk";
import type { MemoryStore } from "./capabilities.js";

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** A log reader over a store's committed log. */
export function createLogReader(store: MemoryStore): LogReader {
  const head = (): Cursor => store.records().at(-1)?.record.cursor ?? LOG_START;

  return {
    async read(from: Cursor, limit: number): Promise<Result<LogPage>> {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError(`a log read's limit is a positive integer, not ${limit}`);
      }
      const records = store.records();
      let start = 0;
      if (from !== LOG_START) {
        // A cursor this log never issued is a defect in the caller, never a §10 outcome.
        if (!DECIMAL.test(from) || Number(from) >= records.length) {
          throw new RangeError(`cursor ${JSON.stringify(from)} was never issued by this log`);
        }
        start = Number(from) + 1;
      }
      const page = records.slice(start, start + limit).map(({ record }) => record);
      return { ok: true, value: { records: page, next: page.at(-1)?.cursor ?? from } };
    },

    hints(): AsyncIterable<Cursor> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<Cursor> {
          // The head not yet delivered, if any; starts with the head at subscription.
          let pending: Cursor | undefined = head();
          let wake: (() => void) | undefined;
          let done = false;
          const unsubscribe = store.onAppend(() => {
            pending = head();
            wake?.();
          });
          const finish = (): IteratorResult<Cursor> => {
            done = true;
            unsubscribe();
            wake?.();
            return { done: true, value: undefined };
          };
          return {
            async next(): Promise<IteratorResult<Cursor>> {
              while (!done) {
                if (pending !== undefined) {
                  const value = pending;
                  pending = undefined;
                  return { done: false, value };
                }
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = undefined;
              }
              return { done: true, value: undefined };
            },
            async return(): Promise<IteratorResult<Cursor>> {
              return finish();
            },
          };
        },
      };
    },
  };
}
