// A `fetch`-based client for C4 (T-007-01, F-007 §5).
//
// `fetch` only: it is what Node 24 and React Native share. No Node streams, no
// native modules, no `TextDecoder`, no `crypto`. The client sends one request
// per call and returns the row of C4.md §4.3 the answer falls in. It never
// retries, resubmits or waits on its own: those are the port's decisions.

import type { Cursor, OperationId, Query } from "@ticketto/sdk";
import { HintParser, HintStreamDefect } from "./hints.js";
import {
  type AssuranceOutcome,
  type CheckpointOutcome,
  type Defect,
  type LogOutcome,
  type OperationOutcome,
  type QueryOutcome,
  RETRY,
  type ReceivedResponse,
  type Retry,
  type SubmitOutcome,
  translateAssurance,
  translateCheckpoint,
  translateHintsResponse,
  translateLog,
  translateOperation,
  translateQuery,
  translateSubmit,
} from "./translate.js";
import {
  assuranceRequest,
  hintsRequest,
  latestCheckpointRequest,
  logRequest,
  operationRequest,
  queryRequest,
  type SignedInputBytes,
  submitRequest,
  type WireRequest,
} from "./wire.js";

/** The part of an `AbortSignal` the client reads. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** A reader of a streamed response body, as `ReadableStream.getReader()` returns. */
export interface BodyReaderLike {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
  cancel(reason?: unknown): Promise<void>;
}

/** The part of a `fetch` `Response` the client uses. */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** A streamed body. Only the hint stream needs one; React Native's `fetch` has none. */
  readonly body?: { getReader(): BodyReaderLike } | null;
}

export interface FetchInit {
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignalLike;
}

/** The part of `fetch` the client uses. The platform's `fetch` satisfies it. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface C4ClientOptions {
  /** The service's base URL, e.g. `https://ledger.example`. C4's paths are appended to it. */
  readonly url: string;
  /**
   * Defaults to the platform's `fetch`, on Node and React Native alike. Pass one
   * only to wrap or replace it.
   */
  readonly fetch?: FetchLike;
}

export interface RequestOptions {
  /**
   * Aborts the request. An aborted request rejects with the platform's abort
   * error rather than reporting a transport failure: the caller asked for it.
   */
  readonly signal?: AbortSignalLike;
}

/** C4.md §3.5: the stream is open, and yields each hint's cursor as it arrives. */
export interface HintStream extends AsyncIterable<Cursor> {
  readonly outcome: "hints";
  /** Closes the stream. */
  close(): Promise<void>;
}

export type HintsOutcome = HintStream | Retry | Defect;

/** A transport failure while reading an open hint stream. The reader reconnects. */
export class HintStreamClosed extends Error {
  constructor(cause: unknown) {
    super("the hint stream failed in transport", { cause });
    this.name = "HintStreamClosed";
  }
}

export interface C4Client {
  /** `POST /v0/submit` (C4.md §3.1). */
  submit(
    input: SignedInputBytes,
    sponsorship: Uint8Array | null,
    options?: RequestOptions,
  ): Promise<SubmitOutcome>;
  /** `GET /v0/operations/{operationId}` (C4.md §3.2). Without `wait`, the service's default. */
  operation(
    operationId: OperationId,
    submission: string,
    options?: RequestOptions & { readonly wait?: number },
  ): Promise<OperationOutcome>;
  /** `POST /v0/query` (C4.md §3.3). */
  query<Q extends Query>(query: Q, options?: RequestOptions): Promise<QueryOutcome<Q>>;
  /** `GET /v0/log` (C4.md §3.4). */
  log(from: Cursor, limit: number, options?: RequestOptions): Promise<LogOutcome>;
  /** `GET /v0/log/hints` (C4.md §3.5). Needs a streamed response body. */
  hints(options?: RequestOptions): Promise<HintsOutcome>;
  /** `GET /v0/assurance` (C4.md §3.6). */
  assurance(options?: RequestOptions): Promise<AssuranceOutcome>;
  /** `GET /v0/checkpoints/latest` (C4.md §3.7). */
  latestCheckpoint(options?: RequestOptions): Promise<CheckpointOutcome>;
}

type Sent = { readonly response: FetchResponseLike } | { readonly failed: unknown };

function platformFetch(): FetchLike {
  const fetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (fetch === undefined)
    throw new Error("this platform has no fetch; pass one to createC4Client");
  return (url, init) => fetch(url, init);
}

export function createC4Client(options: C4ClientOptions): C4Client {
  const base = options.url.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]/.test(base)) throw new TypeError("the C4 service URL must be http(s)");
  const fetch = options.fetch ?? platformFetch();

  async function send(
    request: WireRequest,
    requestOptions: RequestOptions | undefined,
  ): Promise<Sent> {
    const init: FetchInit = {
      method: request.method,
      headers: request.headers ?? {},
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
    };
    try {
      return { response: await fetch(`${base}${request.path}`, init) };
    } catch (error) {
      if (requestOptions?.signal?.aborted === true) throw error;
      return { failed: error };
    }
  }

  /** Reads the whole body. A transport failure, before or during, is `undefined`. */
  async function receive(
    request: WireRequest,
    requestOptions: RequestOptions | undefined,
  ): Promise<ReceivedResponse | undefined> {
    const sent = await send(request, requestOptions);
    if ("failed" in sent) return undefined;
    const { response } = sent;
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (requestOptions?.signal?.aborted === true) throw error;
      return undefined;
    }
    return { status: response.status, header: (name) => response.headers.get(name), text };
  }

  return {
    async submit(input, sponsorship, requestOptions) {
      const received = await receive(submitRequest(input, sponsorship), requestOptions);
      return received === undefined ? RETRY : translateSubmit(received);
    },

    async operation(operationId, submission, requestOptions) {
      const request = operationRequest(operationId, submission, requestOptions?.wait);
      const received = await receive(request, requestOptions);
      return received === undefined ? RETRY : translateOperation(received, operationId);
    },

    async query(query, requestOptions) {
      const received = await receive(queryRequest(query), requestOptions);
      return received === undefined ? RETRY : translateQuery(received, query);
    },

    async log(from, limit, requestOptions) {
      const received = await receive(logRequest(from, limit), requestOptions);
      return received === undefined ? RETRY : translateLog(received, from, limit);
    },

    async hints(requestOptions) {
      const sent = await send(hintsRequest(), requestOptions);
      if ("failed" in sent) return RETRY;
      const { response } = sent;
      let text = "";
      if (response.status !== 200) {
        // Not a stream: an error body, read to its end to decide its row.
        try {
          text = await response.text();
        } catch (error) {
          if (requestOptions?.signal?.aborted === true) throw error;
          return RETRY;
        }
      }
      const opened = translateHintsResponse({
        status: response.status,
        header: (name) => response.headers.get(name),
        text,
      });
      if (opened.outcome !== "hints") return opened;
      const body = response.body;
      if (body === undefined || body === null) {
        throw new Error("this platform's fetch does not stream response bodies; poll instead");
      }
      return hintStream(body.getReader());
    },

    async assurance(requestOptions) {
      const received = await receive(assuranceRequest(), requestOptions);
      return received === undefined ? RETRY : translateAssurance(received);
    },

    async latestCheckpoint(requestOptions) {
      const received = await receive(latestCheckpointRequest(), requestOptions);
      return received === undefined ? RETRY : translateCheckpoint(received);
    },
  };
}

/**
 * The cursors of an open hint stream. Iteration ends when the service closes
 * the stream between events; it throws `HintStreamDefect` on a stream that is
 * not C4 and `HintStreamClosed` on a transport failure. Written without an
 * async generator, which not every React Native Babel configuration transforms.
 */
function hintStream(reader: BodyReaderLike): HintStream {
  const parser = new HintParser();
  const ready: Cursor[] = [];
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    ready.length = 0;
    await reader.cancel().catch(() => {});
  };

  const fail = async (error: unknown): Promise<never> => {
    await close();
    throw error;
  };

  const next = async (): Promise<IteratorResult<Cursor, undefined>> => {
    while (ready.length === 0) {
      if (closed) return { done: true, value: undefined };
      let chunk: { readonly done: boolean; readonly value?: Uint8Array | undefined };
      try {
        chunk = await reader.read();
      } catch (error) {
        if (closed) return { done: true, value: undefined };
        return fail(new HintStreamClosed(error));
      }
      if (chunk.done) {
        if (!parser.idle)
          return fail(new HintStreamDefect("the hint stream ended inside an event"));
        await close();
        return { done: true, value: undefined };
      }
      if (chunk.value === undefined) continue;
      try {
        ready.push(...parser.push(chunk.value));
      } catch (error) {
        return fail(error);
      }
    }
    return { done: false, value: ready.shift() as Cursor };
  };

  return {
    outcome: "hints",
    close,
    [Symbol.asyncIterator]() {
      return {
        next,
        async return() {
          await close();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
