// T-007-01 — the C4 vectors, reproduced by the binding (REQ-SDK-1; C4.md §6).
//
// For every exchange in test/c4/c4-v0.json (vendored from ticketto-offchain at
// the commit test/c4/source.json records):
//
// - a request the binding sends is rebuilt by the binding's own request builder,
//   byte for byte, and sent through the client to a `fetch` that answers with
//   the recorded response;
// - a request the service answers `400 malformed` is one the builder refuses to
//   produce, and the recorded response is classified directly;
// - what the client returns is the exchange's `binding` column: the row of
//   C4.md §4.3 the response falls in.
//
// Portable: runs under Vitest on Node and under the Hermes VM.

import type { Cursor, OperationId, Query } from "@ticketto/sdk";
import { createC4Client, type HintsOutcome } from "../../src/client.js";
import { toHex } from "../../src/hex.js";
import { HintParser, HintStreamDefect } from "../../src/hints.js";
import {
  type ReceivedResponse,
  translateAssurance,
  translateCheckpoint,
  translateHintsResponse,
  translateLog,
  translateOperation,
  translateQuery,
  translateSubmit,
  WIRE_CODES,
} from "../../src/translate.js";
import {
  assuranceRequest,
  ENDPOINTS,
  type Endpoint,
  hintsRequest,
  type Json,
  latestCheckpointRequest,
  logRequest,
  operationRequest,
  queryRequest,
  type SignedInputBytes,
  submitRequest,
  type WireRequest,
} from "../../src/wire.js";
import { BASE_URL, bytesOf, drain, scriptedFetch } from "../fake-fetch.js";
import { assert, assertEqual, type Suite } from "../harness.js";

type Body = { readonly [key: string]: Json };

export interface Exchange {
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly covers: readonly string[];
  readonly request: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Json;
  };
  readonly response:
    | {
        readonly status: number;
        readonly headers: Readonly<Record<string, string>>;
        readonly body?: Json;
        readonly text?: string;
      }
    | { readonly transport: string };
  readonly binding: { readonly surface: string } & Body;
}

export interface C4Vectors {
  readonly protocol: string;
  readonly version: string;
  readonly exchanges: readonly Exchange[];
}

/** The surfaces C4.md §4.3 names, as the vectors spell them. */
const SURFACES = [
  "defect",
  "hints",
  "pending",
  "rejected",
  "resubmit",
  "retry",
  "settled",
  "submitted",
  "value",
];

/** JSON of a client value: byte strings as hex, as the vectors carry them. */
function json(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (v instanceof Uint8Array ? toHex(v) : v)),
  ) as unknown;
}

/** Hex in any case, so a vector's upper-case bytes can be handed to a builder. */
function anyCaseHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

function object(value: Json | undefined): Body {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "not an object");
  return value as Body;
}

const OPERATION_PATH = /^\/v0\/operations\/([^?]*)\?submission=([^&]*)(?:&wait=(\d+))?$/;
const LOG_PATH = /^\/v0\/log\?from=([^&]*)&limit=(-?\d+)$/;

/** What the binding's builder makes of the exchange's request, or the error it refuses with. */
function rebuild(e: Exchange): WireRequest | Error {
  try {
    switch (e.endpoint) {
      case "POST /v0/submit": {
        const body = object(e.request.body);
        const input = object(body.input);
        const signed = {
          kind: input.kind,
          bytes: anyCaseHex(input.bytes as string),
          ...("presentedAt" in body ? { presentedAt: body.presentedAt } : {}),
        } as unknown as SignedInputBytes;
        const sponsorship =
          body.sponsorship === null ? null : anyCaseHex(body.sponsorship as string);
        return submitRequest(signed, sponsorship);
      }
      case "GET /v0/operations/{operationId}": {
        const match = OPERATION_PATH.exec(e.request.path);
        assert(match !== null, "not an operation path");
        const wait = match[3] === undefined ? undefined : Number(match[3]);
        return operationRequest(match[1] as OperationId, match[2] as string, wait);
      }
      case "POST /v0/query":
        return queryRequest(e.request.body as unknown as Query);
      case "GET /v0/log": {
        const match = LOG_PATH.exec(e.request.path);
        assert(match !== null, "not a log path");
        return logRequest(match[1] as Cursor, Number(match[2]));
      }
      case "GET /v0/log/hints":
        return hintsRequest();
      case "GET /v0/assurance":
        return assuranceRequest();
      case "GET /v0/checkpoints/latest":
        return latestCheckpointRequest();
      default:
        throw new Error(`unknown endpoint ${String(e.endpoint)}`);
    }
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** The request exactly as the vector records it, serialised as the client serialises. */
function sameRequest(built: WireRequest, e: Exchange): boolean {
  return (
    built.method === e.request.method &&
    built.path === e.request.path &&
    JSON.stringify(built.headers ?? {}) === JSON.stringify(e.request.headers ?? {}) &&
    JSON.stringify(built.body) === JSON.stringify(e.request.body)
  );
}

function responseText(response: Exclude<Exchange["response"], { transport: string }>): string {
  return response.text ?? (response.body === undefined ? "" : JSON.stringify(response.body));
}

/** The surface form of a client outcome, as the vectors' `binding` column spells it. */
async function surfaceOf(
  endpoint: Endpoint,
  outcome: { readonly outcome: string } & object,
): Promise<unknown> {
  const o = outcome as Record<string, unknown> & { outcome: string };
  switch (o.outcome) {
    case "submitted":
      return { surface: "submitted", operationId: o.operationId };
    case "settled":
      return { surface: "settled", receipt: json(o.receipt) };
    case "rejected":
      return { surface: "rejected", error: json(o.error) };
    case "value":
      // The vectors record the assurance row's value as the response body, which
      // wraps the declaration the client returns; every other value is as returned.
      return {
        surface: "value",
        value: json(endpoint === "GET /v0/assurance" ? { assurance: o.value } : o.value),
      };
    case "hints":
      return {
        surface: "hints",
        cursors: await drain(outcome as unknown as AsyncIterable<string>),
      };
    case "retry":
      // The row says: retry, and reject with ERR-LedgerUnavailable once the
      // retry budget is spent. The budget is the port's (T-007-02, T-007-07).
      return { surface: "retry", exhausted: "ERR-LedgerUnavailable" };
    case "pending":
    case "resubmit":
    case "defect":
      return { surface: o.outcome };
    default:
      throw new Error(`unknown outcome ${o.outcome}`);
  }
}

/** Runs the exchange's request through the client, against the recorded response. */
async function throughClient(e: Exchange): Promise<{ readonly outcome: string } & object> {
  const scripted =
    "transport" in e.response
      ? { transport: e.response.transport }
      : { status: e.response.status, headers: e.response.headers, text: responseText(e.response) };
  const { fetch, seen } = scriptedFetch([scripted]);
  const client = createC4Client({ url: `${BASE_URL}/`, fetch });
  let outcome: { readonly outcome: string } & object;
  switch (e.endpoint) {
    case "POST /v0/submit": {
      const body = object(e.request.body);
      const input = object(body.input);
      const bytes = anyCaseHex(input.bytes as string);
      const signed: SignedInputBytes =
        input.kind === "pass"
          ? { kind: "pass", bytes, presentedAt: body.presentedAt as number }
          : { kind: "command", bytes };
      const sponsorship = body.sponsorship === null ? null : anyCaseHex(body.sponsorship as string);
      outcome = await client.submit(signed, sponsorship);
      break;
    }
    case "GET /v0/operations/{operationId}": {
      const match = OPERATION_PATH.exec(e.request.path) as RegExpExecArray;
      outcome = await client.operation(
        match[1] as OperationId,
        match[2] as string,
        match[3] === undefined ? {} : { wait: Number(match[3]) },
      );
      break;
    }
    case "POST /v0/query":
      outcome = await client.query(e.request.body as unknown as Query);
      break;
    case "GET /v0/log": {
      const match = LOG_PATH.exec(e.request.path) as RegExpExecArray;
      outcome = await client.log(match[1] as Cursor, Number(match[2]));
      break;
    }
    case "GET /v0/log/hints":
      outcome = (await client.hints()) as HintsOutcome;
      break;
    case "GET /v0/assurance":
      outcome = await client.assurance();
      break;
    case "GET /v0/checkpoints/latest":
      outcome = await client.latestCheckpoint();
      break;
    default:
      throw new Error(`unknown endpoint ${String(e.endpoint)}`);
  }
  assertEqual(seen.length, 1, "the client sends exactly one request");
  const sent = seen[0];
  assert(sent !== undefined);
  assertEqual(
    `${sent.url} ${sent.init.method}`,
    `${BASE_URL}${e.request.path} ${e.request.method}`,
  );
  assertEqual(sent.init.headers, e.request.headers ?? {}, "request headers");
  assertEqual(
    sent.init.body,
    e.request.body === undefined ? undefined : JSON.stringify(e.request.body),
    "request body",
  );
  return outcome;
}

/** Classifies the recorded response of a request the binding never sends. */
async function directly(e: Exchange): Promise<{ readonly outcome: string } & object> {
  assert(!("transport" in e.response), "a request the binding never sends got no response");
  const r = e.response;
  const received: ReceivedResponse = {
    status: r.status,
    header: (name) => r.headers[name.toLowerCase()] ?? null,
    text: responseText(r),
  };
  switch (e.endpoint) {
    case "POST /v0/submit":
      return translateSubmit(received);
    case "GET /v0/operations/{operationId}": {
      const match = OPERATION_PATH.exec(e.request.path) as RegExpExecArray;
      return translateOperation(received, match[1] as OperationId);
    }
    case "POST /v0/query":
      return translateQuery(received, e.request.body as unknown as Query);
    case "GET /v0/log": {
      const match = LOG_PATH.exec(e.request.path) as RegExpExecArray;
      return translateLog(received, match[1] as Cursor, Number(match[2]));
    }
    case "GET /v0/log/hints": {
      const opened = translateHintsResponse(received);
      if (opened.outcome === "hints")
        throw new Error("an open hint stream is read through the client");
      return opened;
    }
    case "GET /v0/assurance":
      return translateAssurance(received);
    case "GET /v0/checkpoints/latest":
      return translateCheckpoint(received);
    default:
      throw new Error(`unknown endpoint ${String(e.endpoint)}`);
  }
}

/**
 * A title naming the §10 error an exchange verifies: the one the binding
 * surfaces for it. A row that only leads to an error later — a retry, before
 * the budget that ends in ERR-LedgerUnavailable — names none.
 */
function title(e: Exchange): string {
  const error = e.binding.error as Body | undefined;
  return typeof error?.code === "string" ? `${error.code}: ${e.name}` : e.name;
}

export function vectorsSuite(vectors: C4Vectors): Suite {
  return (t) => {
    t.describe("T-007-01 C4 vectors", () => {
      t.it("are C4 version 0, and cover every endpoint and every row of §4.3", () => {
        assertEqual(`${vectors.protocol} ${vectors.version}`, "C4 v0");
        for (const endpoint of ENDPOINTS) {
          assert(
            vectors.exchanges.some((e) => e.endpoint === endpoint),
            `no vector for ${endpoint}`,
          );
        }
        const surfaces = [...new Set(vectors.exchanges.map((e) => e.binding.surface))].sort();
        assertEqual(surfaces, [...SURFACES].sort(), "surfaces");
      });

      t.it("carry exactly the wire codes the binding maps (C4.md §4.2)", () => {
        const codes = new Set<string>();
        for (const e of vectors.exchanges) {
          if ("transport" in e.response || e.response.status < 300) continue;
          const body = e.response.body as Body | undefined;
          const error = body?.error as Body | undefined;
          if (typeof error?.code === "string") codes.add(error.code);
        }
        assertEqual([...codes].sort(), Object.keys(WIRE_CODES).sort(), "wire codes");
      });

      for (const e of vectors.exchanges) {
        t.it(title(e), async () => {
          const built = rebuild(e);
          const malformed = !("transport" in e.response) && e.response.status === 400;
          let outcome: { readonly outcome: string } & object;
          if (malformed) {
            assert(
              built instanceof Error || !sameRequest(built, e),
              "the builder produces a request the service calls malformed",
            );
            outcome = await directly(e);
          } else if (!(built instanceof Error) && sameRequest(built, e)) {
            outcome = await throughClient(e);
          } else {
            // Only a path this version does not have is not the builders' to make.
            assert(
              e.covers.includes("wire error not-found"),
              `the builder does not reproduce ${e.request.path}`,
            );
            outcome = await directly(e);
          }
          if (outcome.outcome === "retry" && !("transport" in e.response)) {
            const header = e.response.headers["retry-after"];
            assertEqual(
              (outcome as unknown as { retryAfter: number | null }).retryAfter,
              header === undefined ? null : Number(header),
              "Retry-After",
            );
          }
          assertEqual(await surfaceOf(e.endpoint, outcome), e.binding, "binding surface");
        });
      }

      t.it("a hint stream split at every byte yields the same cursors", () => {
        const e = vectors.exchanges.find((x) => x.endpoint === "GET /v0/log/hints");
        assert(e !== undefined && !("transport" in e.response));
        const bytes = bytesOf(e.response.text ?? "");
        const parser = new HintParser();
        const cursors: string[] = [];
        for (let i = 0; i < bytes.length; i++) cursors.push(...parser.push(bytes.slice(i, i + 1)));
        assertEqual(cursors, e.binding.cursors, "cursors");
        assert(parser.idle, "the stream ends between events");
        let threw = false;
        try {
          new HintParser().push(bytesOf("event: record\ndata: {}\n\n"));
        } catch (error) {
          threw = error instanceof HintStreamDefect;
        }
        assert(threw, "an event that is not a hint is a defect");
      });
    });
  };
}
