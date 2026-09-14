// T-007-04 — the error translation table (REQ-SDK-2). Done when: every wire code
// in C4 maps; an unknown code fails the test suite.
//
// Every code × every endpoint × every status is run through the classifier the
// client uses, and must land on the table's row — or on a defect where C4 does
// not send that code. `assertMapped` is what makes an unknown code fail the
// suite: every code the vendored vectors (here) and C4.md (on Node) carry goes
// through it. Portable: Node and Hermes.

import {
  type Cursor,
  type OperationId,
  type Query,
  TICKETTO_ERROR_CODES,
  TICKETTO_ERROR_ORIGINS,
  type TickettoErrorCode,
} from "@ticketto/sdk";
import {
  type ReceivedResponse,
  translateAssurance,
  translateCheckpoint,
  translateHintsResponse,
  translateLog,
  translateOperation,
  translateQuery,
  translateSubmit,
} from "../../src/translate.js";
import {
  codesRaisedByBinding,
  UNAVAILABLE_CODE,
  WIRE_TRANSLATION,
  type WireCode,
  type WireTranslation,
} from "../../src/translation.js";
import { ENDPOINTS, type Endpoint } from "../../src/wire.js";
import { AssertionError, assert, assertEqual, assertThrows, type Suite } from "../harness.js";
import type { C4Vectors } from "./vectors.suite.js";

const OPERATION = "8333f96fa07b1d2cf5e3fdb00a0955ea" as OperationId;
const QUERY = {
  kind: "getTicket",
  ticket: "f00837ecb1c7892300ba5273d0ded5e0bce76595f9d911ddb31e511d6d91be8c",
} as Query;
const STATUSES = [400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504];

function received(status: number, body: unknown): ReceivedResponse {
  return {
    status,
    header: (name) => (name === "content-type" ? "application/json; charset=utf-8" : null),
    text: typeof body === "string" ? body : JSON.stringify(body),
  };
}

/** The outcome the client's classifier gives `response` from `endpoint`. */
export function classify(
  endpoint: Endpoint,
  response: ReceivedResponse,
): { readonly outcome: string } & Record<string, unknown> {
  switch (endpoint) {
    case "POST /v0/submit":
      return translateSubmit(response) as never;
    case "GET /v0/operations/{operationId}":
      return translateOperation(response, OPERATION) as never;
    case "POST /v0/query":
      return translateQuery(response, QUERY) as never;
    case "GET /v0/log":
      return translateLog(response, "" as Cursor, 10) as never;
    case "GET /v0/log/hints":
      return translateHintsResponse(response) as never;
    case "GET /v0/assurance":
      return translateAssurance(response) as never;
    case "GET /v0/checkpoints/latest":
      return translateCheckpoint(response) as never;
    default:
      throw new Error(`unknown endpoint ${String(endpoint)}`);
  }
}

/** The outcome the table says a wire code sent with `status` from `endpoint` must give. */
function expected(code: WireCode, status: number, endpoint: Endpoint): unknown {
  const entry: WireTranslation = WIRE_TRANSLATION[code];
  if (!entry.statuses.includes(status) || !entry.endpoints.includes(endpoint)) return "defect";
  const { translation } = entry;
  switch (translation.row) {
    case "rejected":
      return { outcome: "rejected", error: { code: translation.code } };
    case "retry":
      return { outcome: "retry", retryAfter: null };
    case "resubmit":
      return { outcome: "resubmit" };
    case "defect":
      return "defect";
    default:
      throw new Error("a row the suite does not know");
  }
}

function shape(outcome: { readonly outcome: string } & Record<string, unknown>): unknown {
  return outcome.outcome === "defect" ? "defect" : outcome;
}

/**
 * Fails with every code in `codes` the table does not map. A wire code the
 * service sends and the binding does not know fails the suite here.
 */
export function assertMapped(codes: Iterable<string>, where: string): void {
  const unmapped = [...codes].filter((code) => !Object.hasOwn(WIRE_TRANSLATION, code));
  if (unmapped.length > 0) {
    throw new AssertionError(
      `${where} carries wire codes with no translation: ${unmapped.join(", ")}`,
    );
  }
}

export function translationSuite(vectors: C4Vectors): Suite {
  return (t) => {
    t.describe("T-007-04 error translation", () => {
      t.it("every wire code the vectors carry has a row", () => {
        const codes = new Set<string>();
        for (const e of vectors.exchanges) {
          if ("transport" in e.response || e.response.status < 300) continue;
          const error = (e.response.body as { error?: { code?: unknown } } | undefined)?.error;
          if (typeof error?.code === "string") codes.add(error.code);
        }
        assertMapped(codes, "the C4 vectors");
        assertEqual([...codes].sort(), Object.keys(WIRE_TRANSLATION).sort(), "codes");
      });

      t.it("an unknown wire code fails the suite", () => {
        assertThrows(
          () => assertMapped(["rate-limited"], "a service"),
          "an unknown code must fail",
        );
        assertThrows(() => assertMapped(["Malformed"], "a service"), "codes are case-sensitive");
      });

      t.it("every wire code lands on its row, from every endpoint and with every status", () => {
        for (const code of Object.keys(WIRE_TRANSLATION) as WireCode[]) {
          for (const endpoint of ENDPOINTS) {
            for (const status of STATUSES) {
              const response = received(status, { error: { code, detail: "x" } });
              assertEqual(
                shape(classify(endpoint, response)),
                expected(code, status, endpoint),
                `${status} ${code} from ${endpoint}`,
              );
            }
          }
        }
      });

      t.it(
        "an unknown wire code is a defect from every endpoint, never a retry or an error",
        () => {
          for (const code of [
            "rate-limited",
            "conflict",
            "",
            "Unavailable",
            "ERR-LedgerUnavailable",
          ]) {
            for (const endpoint of ENDPOINTS) {
              for (const status of STATUSES) {
                const outcome = classify(endpoint, received(status, { error: { code } }));
                assertEqual(
                  outcome.outcome,
                  "defect",
                  `${status} ${JSON.stringify(code)} from ${endpoint}`,
                );
              }
            }
          }
        },
      );

      t.it(
        "a non-2xx response without a C4 body is a retry when 5xx, and a defect otherwise",
        () => {
          for (const endpoint of ENDPOINTS) {
            for (const status of STATUSES) {
              const outcome = classify(endpoint, received(status, "<html>proxy</html>"));
              assertEqual(
                outcome.outcome,
                status >= 500 ? "retry" : "defect",
                `${status} from ${endpoint}`,
              );
            }
          }
        },
      );

      t.it(
        "§10 codes pass through only when ledger-origin, from every place C4 carries one",
        () => {
          for (const code of TICKETTO_ERROR_CODES) {
            const ledger = TICKETTO_ERROR_ORIGINS[code] === "ledger";
            const rejected = { outcome: "rejected", error: { code } };
            assertEqual(
              shape(classify("POST /v0/submit", received(422, { rejection: { code } }))),
              ledger ? rejected : "defect",
              `422 ${code}`,
            );
            assertEqual(
              shape(
                classify(
                  "GET /v0/operations/{operationId}",
                  received(200, { state: "rejected", error: { code } }),
                ),
              ),
              ledger ? rejected : "defect",
              `rejected ${code}`,
            );
            assertEqual(
              shape(
                classify(
                  "POST /v0/query",
                  received(200, { result: { ok: false, error: { code } } }),
                ),
              ),
              ledger ? { outcome: "value", value: { ok: false, error: { code } } } : "defect",
              `query error ${code}`,
            );
            for (const endpoint of ENDPOINTS.filter((e) => e !== "POST /v0/submit")) {
              assertEqual(
                classify(endpoint, received(422, { rejection: { code } })).outcome,
                "defect",
                `422 from ${endpoint}`,
              );
            }
          }
        },
      );

      t.it(
        "ERR-SponsorshipRefused and ERR-LedgerUnavailable: the binding raises binding-origin codes, and all of them",
        () => {
          const raised = codesRaisedByBinding().sort();
          for (const code of raised) {
            assertEqual(TICKETTO_ERROR_ORIGINS[code], "binding", `${code} is binding-origin`);
          }
          const binding = (Object.keys(TICKETTO_ERROR_ORIGINS) as TickettoErrorCode[])
            .filter((code) => TICKETTO_ERROR_ORIGINS[code] === "binding")
            .sort();
          assertEqual(raised, binding, "binding-origin codes");
          assert(raised.includes(UNAVAILABLE_CODE), "G8's code");
        },
      );
    });
  };
}
