// The log reader over C4, with hints — T-007-03; F-007 §5; REQ-SDK-5, AD-17.
//
// Reading by cursor is authoritative: `read` fetches `GET /v0/log` and decodes
// each entry with the profile's signed-input decoders into the SDK's
// `SignedCommand` or `SignedAccessPass` (C4.md §3.4, F-003 §5). Hints only say
// when to read, and carry cursors, never records:
//
// - **events** — the service's server-sent hint stream (C4.md §3.5), on
//   platforms whose `fetch` streams response bodies (Node);
// - **poll** — `GET /v0/checkpoints/latest`'s `head`, polled, on platforms whose
//   `fetch` does not (React Native).
//
// Either way a reader sees the head when it starts iterating and the latest
// head after it moves, coalesced, as `backend-memory`'s reader does. A hint
// transport that fails reconnects with backoff for as long as the reader
// iterates: a lost hint costs latency, never data.

import { decodeSignedAccessPass, decodeSignedCommand } from "@ticketto/profile-v0";
import type {
  Cursor,
  EventId,
  LogPage,
  LogReader,
  LogRecord,
  Result,
  SignedAccessPass,
  SignedCommand,
} from "@ticketto/sdk";
import {
  type C4Client,
  type HintStream,
  HintStreamClosed,
  HintStreamUnsupported,
} from "./client.js";
import { LEDGER_UNAVAILABLE, type Retrier } from "./retry.js";
import { C4Defect } from "./submit.js";
import type { WireLogRecord } from "./translate.js";
import { LIMIT_MAX } from "./wire.js";

/** How a reader learns that the head moved. */
export type HintTransport = "events" | "poll" | "auto";

export interface OffchainLogOptions {
  readonly client: C4Client;
  readonly retrier: Retrier;
  /** How long one read may take before it is abandoned and retried, in milliseconds. */
  readonly timeout: number;
  /**
   * `events` streams hints; `poll` polls the head; `auto`, the default, streams,
   * and polls from the first time the platform's `fetch` returns no streamed body.
   */
  readonly hints?: HintTransport;
  /** How often `poll` reads the head, in milliseconds. */
  readonly pollInterval?: number;
}

/** A log record as the SDK carries it, from its C4 form. */
export function decodeRecord(record: WireLogRecord): LogRecord {
  let entry: SignedCommand | SignedAccessPass;
  if (record.entry.kind === "command") {
    const decoded = decodeSignedCommand(record.entry.bytes);
    if (!decoded.ok) throw new C4Defect(`a log entry that does not decode: ${decoded.error.code}`);
    entry = decoded.value;
  } else {
    const decoded = decodeSignedAccessPass(record.entry.bytes);
    if (!decoded.ok) throw new C4Defect(`a log entry that does not decode: ${decoded.error.code}`);
    entry = decoded.value;
  }
  return {
    cursor: record.cursor,
    recordedAt: record.recordedAt,
    event:
      record.event === null
        ? null
        : { id: record.event.id as EventId, sequence: record.event.sequence },
    entry,
    presentedAt: record.presentedAt,
  };
}

export function createOffchainLog(options: OffchainLogOptions): LogReader {
  const { client, retrier, timeout } = options;
  const pollInterval = options.pollInterval ?? 1_000;
  let transport: HintTransport = options.hints ?? "auto";

  const read = async (from: Cursor, limit: number): Promise<Result<LogPage>> => {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError(`a log read's limit is a positive integer, not ${limit}`);
    }
    // C4 serves at most LIMIT_MAX records a page; a shorter page never implies
    // the end of the log (C4.md §3.4, `LogPage`).
    const pageLimit = Math.min(limit, LIMIT_MAX);
    const outcome = await retrier.read(
      (signal) => client.log(from, pageLimit, signal === undefined ? {} : { signal }),
      timeout,
    );
    switch (outcome.outcome) {
      case "value":
        return {
          ok: true,
          value: { records: outcome.value.records.map(decodeRecord), next: outcome.value.next },
        };
      case "unavailable":
        return { ok: false, error: LEDGER_UNAVAILABLE };
      case "defect":
        throw new C4Defect(outcome.reason);
      default:
        throw new C4Defect("an unmapped log outcome");
    }
  };

  const hints = (): AsyncIterable<Cursor> => ({
    [Symbol.asyncIterator](): AsyncIterator<Cursor> {
      let done = false;
      let last: Cursor | undefined;
      let stream: HintStream | undefined;
      let streamIterator: AsyncIterator<Cursor> | undefined;
      let failures = 0;

      const closeStream = async () => {
        const open = stream;
        stream = undefined;
        streamIterator = undefined;
        await open?.close();
      };

      /**
       * Waits after a failed hint transport. Hints never end on unavailability:
       * past the budget, they keep trying at the longest backoff.
       */
      const backOff = async (retryAfter: number | null = null) => {
        failures += 1;
        if (!done) await retrier.sleep(retrier.delay(failures, retryAfter));
      };

      /** The next hint from the stream; `undefined` after a failure it recovered from. */
      const nextByEvents = async (): Promise<Cursor | undefined> => {
        if (streamIterator === undefined) {
          const opened = await client.hints();
          if (opened.outcome === "retry") {
            await backOff(opened.retryAfter);
            return undefined;
          }
          if (opened.outcome === "defect") throw new C4Defect(opened.reason);
          stream = opened;
          streamIterator = opened[Symbol.asyncIterator]();
        }
        let next: IteratorResult<Cursor>;
        try {
          next = await streamIterator.next();
        } catch (error) {
          await closeStream();
          if (!(error instanceof HintStreamClosed)) {
            throw error instanceof Error ? new C4Defect(error.message) : error;
          }
          await backOff();
          return undefined;
        }
        if (next.done === true) {
          // The service closed the stream: reconnect; its first hint re-establishes the head.
          await closeStream();
          await backOff();
          return undefined;
        }
        failures = 0;
        return next.value;
      };

      /** The head, by polling; `undefined` while the service cannot be reached. */
      const nextByPoll = async (): Promise<Cursor | undefined> => {
        if (last !== undefined) await retrier.sleep(pollInterval);
        if (done) return undefined;
        const outcome = await retrier.read(
          (signal) => client.latestCheckpoint(signal === undefined ? {} : { signal }),
          timeout,
        );
        switch (outcome.outcome) {
          case "value":
            failures = 0;
            return outcome.value.head;
          case "unavailable":
            await backOff();
            return undefined;
          case "defect":
            throw new C4Defect(outcome.reason);
          default:
            throw new C4Defect("an unmapped checkpoint outcome");
        }
      };

      return {
        async next(): Promise<IteratorResult<Cursor>> {
          while (!done) {
            let cursor: Cursor | undefined;
            if (transport === "poll") {
              cursor = await nextByPoll();
            } else {
              try {
                cursor = await nextByEvents();
              } catch (error) {
                if (!(error instanceof HintStreamUnsupported) || transport === "events")
                  throw error;
                // `auto`: this platform cannot stream, so poll from now on.
                transport = "poll";
                continue;
              }
            }
            if (!done && cursor !== undefined && cursor !== last) {
              last = cursor;
              return { done: false, value: cursor };
            }
          }
          return { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<Cursor>> {
          done = true;
          await closeStream();
          return { done: true, value: undefined };
        },
      };
    },
  });

  return { read, hints };
}
