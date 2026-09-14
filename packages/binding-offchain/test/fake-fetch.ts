// A `fetch` that answers from a script, for the portable suites. It needs no
// platform `fetch`, `Response`, `ReadableStream` or `TextEncoder`, so it runs
// under the bare Hermes VM as well as Node.

import type { BodyReaderLike, FetchInit, FetchLike, FetchResponseLike } from "../src/client.js";
import { AssertionError } from "./harness.js";

export const BASE_URL = "https://ledger.example";

export interface ScriptedResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** The body as sent. */
  readonly text?: string;
  /** Size of the chunks a streamed body arrives in. Defaults to 7 bytes. */
  readonly chunk?: number;
  /** A transport failure part-way through the streamed body, after this many bytes. */
  readonly failAfter?: number;
}

/** No HTTP response at all: the connection was refused, reset, or timed out. */
export interface ScriptedFailure {
  readonly transport: string;
}

export interface SeenRequest {
  readonly url: string;
  readonly init: FetchInit;
}

/** ASCII bytes of `text`. The scripted streams are ASCII, except where a test says otherwise. */
export function bytesOf(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new AssertionError("scripted bodies are single-byte");
    bytes[i] = code;
  }
  return bytes;
}

function reader(bytes: Uint8Array, size: number, failAfter: number | undefined): BodyReaderLike {
  let offset = 0;
  let cancelled = false;
  return {
    async read() {
      if (cancelled) return { done: true };
      if (failAfter !== undefined && offset >= failAfter) throw new TypeError("terminated");
      if (offset >= bytes.length) return { done: true };
      const end = Math.min(bytes.length, offset + size, failAfter ?? bytes.length);
      const value = bytes.slice(offset, end);
      offset = end;
      return { done: false, value };
    },
    async cancel() {
      cancelled = true;
    },
  };
}

/** A `fetch` answering each call with the next scripted response, recording what it was sent. */
export function scriptedFetch(script: readonly (ScriptedResponse | ScriptedFailure)[]): {
  readonly fetch: FetchLike;
  readonly seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const next = script[seen.length];
    seen.push({ url, init });
    if (next === undefined) throw new AssertionError(`unexpected request ${init.method} ${url}`);
    if ("transport" in next) throw new TypeError(`fetch failed: ${next.transport}`);
    const headers = next.headers ?? {};
    const text = next.text ?? "";
    const response: FetchResponseLike = {
      status: next.status,
      headers: {
        get(name) {
          const wanted = name.toLowerCase();
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === wanted) return headers[key] ?? null;
          }
          return null;
        },
      },
      async text() {
        if (next.failAfter !== undefined) throw new TypeError("terminated");
        return text;
      },
      body: {
        getReader: () => reader(bytesOf(text), next.chunk ?? 7, next.failAfter),
      },
    };
    return response;
  };
  return { fetch, seen };
}

/**
 * Every cursor an open hint stream yields, until it ends. Iterated by hand:
 * `for await` is not transformed by every React Native Babel configuration.
 */
export async function drain(stream: AsyncIterable<string>): Promise<string[]> {
  const cursors: string[] = [];
  const iterator = stream[Symbol.asyncIterator]();
  for (;;) {
    const { done, value } = await iterator.next();
    if (done === true) return cursors;
    cursors.push(value);
  }
}
