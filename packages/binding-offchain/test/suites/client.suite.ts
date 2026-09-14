// T-007-01 — the client beyond the vectors: responses that fit no row of
// C4.md §4.3 are defects, transport failures are retries, and requests the
// service would call malformed are never built. Portable: Node and Hermes.

import type { Cursor, OperationId, Query } from "@ticketto/sdk";
import { INVARIANT_IDS } from "@ticketto/sdk";
import { createC4Client, HintStreamClosed } from "../../src/client.js";
import { HintParser, HintStreamDefect } from "../../src/hints.js";
import {
  logRequest,
  MAX_BODY_BYTES,
  operationRequest,
  queryRequest,
  submitRequest,
} from "../../src/wire.js";
import {
  BASE_URL,
  bytesOf,
  drain,
  type ScriptedFailure,
  type ScriptedResponse,
  scriptedFetch,
} from "../fake-fetch.js";
import { assert, assertEqual, assertRejects, assertThrows, type Suite } from "../harness.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const OPERATION = "8333f96fa07b1d2cf5e3fdb00a0955ea" as OperationId;
const TICKET = "f00837ecb1c7892300ba5273d0ded5e0bce76595f9d911ddb31e511d6d91be8c";
const EVENT = "a849673efd6c727a86c6067474e08ef65ce5177e631f1f233c7169f29380ff1b";

function reply(status: number, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return { status, headers, text: JSON.stringify(body) };
}

function clientWith(...script: (ScriptedResponse | ScriptedFailure)[]) {
  const scripted = scriptedFetch(script);
  return { client: createC4Client({ url: BASE_URL, fetch: scripted.fetch }), seen: scripted.seen };
}

const COMMAND = { kind: "command", bytes: new Uint8Array([0, 1, 2]) } as const;
const SPONSORSHIP = new Uint8Array([9, 9]);
const GET_TICKET = { kind: "getTicket", ticket: TICKET } as Query;

async function outcomeOf(promise: Promise<{ readonly outcome: string }>): Promise<string> {
  return (await promise).outcome;
}

export const clientSuite: Suite = (t) => {
  t.describe("T-007-01 C4 client", () => {
    t.describe("responses that fit no row of §4.3 are defects", () => {
      t.it("an unknown wire code", async () => {
        const { client } = clientWith(reply(409, { error: { code: "conflict" } }));
        assertEqual(await outcomeOf(client.submit(COMMAND, SPONSORSHIP)), "defect");
      });

      t.it("a wire code on a status C4 does not give it", async () => {
        const { client } = clientWith(reply(500, { error: { code: "unavailable" } }));
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "defect");
      });

      t.it("a sponsorship code from any endpoint but submit", async () => {
        const { client } = clientWith(reply(403, { error: { code: "sponsorship-invalid" } }));
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "defect");
      });

      t.it("a 422 rejection from a query", async () => {
        const { client } = clientWith(reply(422, { rejection: { code: "ERR-InvalidPass" } }));
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "defect");
      });

      t.it("a binding-origin §10 code carried by the service", async () => {
        const { client } = clientWith(
          reply(200, { state: "rejected", error: { code: "ERR-LedgerUnavailable" } }),
        );
        assertEqual(await outcomeOf(client.operation(OPERATION, "s1")), "defect");
      });

      t.it("a platform-origin §10 code carried by the service", async () => {
        const { client } = clientWith(
          reply(200, { result: { ok: false, error: { code: "ERR-UnknownClass" } } }),
        );
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "defect");
      });

      t.it("a code that is not in §10, or an error with fields C4 does not define", async () => {
        const { client } = clientWith(
          reply(200, { state: "rejected", error: { code: "ERR-Nope" } }),
          reply(200, { state: "rejected", error: { code: "ERR-PassReplayed", sql: "x" } }),
        );
        assertEqual(await outcomeOf(client.operation(OPERATION, "s1")), "defect");
        assertEqual(await outcomeOf(client.operation(OPERATION, "s1")), "defect");
      });

      t.it("a receipt for another operation", async () => {
        const { client } = clientWith(
          reply(200, { state: "settled", receipt: { operationId: "00".repeat(16), cursor: "1" } }),
        );
        assertEqual(await outcomeOf(client.operation(OPERATION, "s1")), "defect");
      });

      t.it("a success status C4 does not give, or a body that is not JSON", async () => {
        const { client } = clientWith(reply(200, { operationId: OPERATION, submission: "s1" }), {
          status: 202,
          headers: JSON_HEADERS,
          text: "accepted",
        });
        assertEqual(await outcomeOf(client.submit(COMMAND, SPONSORSHIP)), "defect");
        assertEqual(await outcomeOf(client.submit(COMMAND, SPONSORSHIP)), "defect");
      });

      t.it("a 4xx page from something in front of the service", async () => {
        const { client } = clientWith({ status: 401, headers: {}, text: "<html></html>" });
        assertEqual(await outcomeOf(client.assurance()), "defect");
      });

      t.it("a log page that is not the page asked for", async () => {
        const record = (cursor: string, presentedAt: number | null) => ({
          cursor,
          recordedAt: 1,
          event: null,
          entry: { kind: "command", bytes: "00" },
          presentedAt,
        });
        const { client } = clientWith(
          reply(200, { records: [record("1", null)], next: "2" }),
          reply(200, { records: [], next: "9" }),
          reply(200, { records: [record("1", 5)], next: "1" }),
          reply(200, { records: [record("1", null), record("2", null)], next: "2" }),
        );
        assertEqual(await outcomeOf(client.log("" as Cursor, 10)), "defect");
        assertEqual(await outcomeOf(client.log("4" as Cursor, 10)), "defect");
        assertEqual(await outcomeOf(client.log("" as Cursor, 10)), "defect");
        assertEqual(await outcomeOf(client.log("" as Cursor, 1)), "defect");
      });

      t.it("an assurance declaration that is not exactly the SDK's invariants", async () => {
        const full = Object.fromEntries(INVARIANT_IDS.map((id) => [id, "attested"]));
        const { [INVARIANT_IDS[0]]: _dropped, ...missing } = full;
        const { client } = clientWith(
          reply(200, { assurance: missing }),
          reply(200, { assurance: { ...full, "INV-99": "enforced" } }),
          reply(200, { assurance: { ...full, "INV-1": "trusted" } }),
          reply(200, { assurance: full }),
        );
        assertEqual(await outcomeOf(client.assurance()), "defect");
        assertEqual(await outcomeOf(client.assurance()), "defect");
        assertEqual(await outcomeOf(client.assurance()), "defect");
        assertEqual(await outcomeOf(client.assurance()), "value");
      });
    });

    t.describe("what the binding ignores and what it retries", () => {
      t.it("response fields C4 does not define are ignored (§1.1)", async () => {
        const { client } = clientWith(
          reply(202, { operationId: OPERATION, submission: "s1", queuedBehind: 3 }),
        );
        const outcome = await client.submit(COMMAND, SPONSORSHIP);
        assertEqual(outcome, { outcome: "submitted", operationId: OPERATION, submission: "s1" });
      });

      t.it("a transport failure before or during the response is a retry", async () => {
        const { client } = clientWith(
          { transport: "reset" },
          { status: 200, headers: JSON_HEADERS, text: "{}", failAfter: 0 },
          { status: 504, headers: { "content-type": "text/html" }, text: "<html></html>" },
        );
        assertEqual(await client.query(GET_TICKET), { outcome: "retry", retryAfter: null });
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "retry");
        assertEqual(await outcomeOf(client.query(GET_TICKET)), "retry");
      });

      t.it("Retry-After is honoured only as a delay in seconds", async () => {
        const unavailable = { error: { code: "unavailable" } };
        const { client } = clientWith(
          reply(503, unavailable, { ...JSON_HEADERS, "Retry-After": "7" }),
          reply(503, unavailable, {
            ...JSON_HEADERS,
            "retry-after": "Fri, 31 Dec 1999 23:59:59 GMT",
          }),
        );
        assertEqual(await client.latestCheckpoint(), { outcome: "retry", retryAfter: 7 });
        assertEqual(await client.latestCheckpoint(), { outcome: "retry", retryAfter: null });
      });

      t.it(
        "a request its caller aborted rejects rather than reporting a transport failure",
        async () => {
          const { client } = clientWith({ transport: "aborted" });
          await assertRejects(() => client.assurance({ signal: { aborted: true } }));
        },
      );

      t.it("operation-unknown from a poll is a resubmission", async () => {
        const { client } = clientWith(reply(404, { error: { code: "operation-unknown" } }));
        assertEqual(await client.operation(OPERATION, "s1"), { outcome: "resubmit" });
      });
    });

    t.describe("the hint stream (§3.5)", () => {
      const stream = (text: string, extra: Partial<ScriptedResponse> = {}): ScriptedResponse => ({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        text,
        ...extra,
      });

      t.it("accepts LF, CR and CRLF line ends, and comments in any bytes", async () => {
        const text =
          'event: hint\r\ndata: {"cursor":"1"}\r\n\r\n:\xe2\x80\x94 keep-alive\n\n' +
          'event:hint\rdata:{"cursor":"2"}\r\r';
        const { client } = clientWith(stream(text, { chunk: 3 }));
        const outcome = await client.hints();
        assert(outcome.outcome === "hints");
        assertEqual(await drain(outcome), ["1", "2"]);
      });

      t.it("a stream that ends inside an event, or carries a record, is a defect", async () => {
        const { client } = clientWith(
          stream('event: hint\ndata: {"cursor":"1"}\n'),
          stream('event: hint\ndata: {"cursor":"1","record":{}}\n\n'),
          stream('event: hint\ndata: {"cursor":"\xe9"}\n\n'),
        );
        for (let i = 0; i < 3; i++) {
          const outcome = await client.hints();
          assert(outcome.outcome === "hints");
          await assertRejects(() => drain(outcome), "HintStreamDefect");
        }
      });

      t.it("a transport failure mid-stream closes it, for the reader to reconnect", async () => {
        const { client } = clientWith(
          stream('event: hint\ndata: {"cursor":"1"}\n\n', { failAfter: 30 }),
        );
        const outcome = await client.hints();
        assert(outcome.outcome === "hints");
        let error: unknown;
        const seen: string[] = [];
        const iterator = outcome[Symbol.asyncIterator]();
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done === true) break;
            seen.push(next.value);
          }
        } catch (caught) {
          error = caught;
        }
        assertEqual(seen, []);
        assert(error instanceof HintStreamClosed, "HintStreamClosed");
      });

      t.it("close() ends iteration", async () => {
        const { client } = clientWith(stream('event: hint\ndata: {"cursor":"1"}\n\n'.repeat(3)));
        const outcome = await client.hints();
        assert(outcome.outcome === "hints");
        const iterator = outcome[Symbol.asyncIterator]();
        assertEqual(await iterator.next(), { done: false, value: "1" });
        await outcome.close();
        assertEqual((await iterator.next()).done, true);
      });

      t.it("a response that is not an event stream is not a stream", async () => {
        const { client } = clientWith(
          reply(200, { head: "1" }),
          reply(503, { error: { code: "unavailable" } }),
        );
        assertEqual(await outcomeOf(client.hints()), "defect");
        assertEqual(await outcomeOf(client.hints()), "retry");
      });

      t.it("the parser refuses a line too long to be a hint", () => {
        assertThrows(() => new HintParser().push(bytesOf(`data: ${"a".repeat(5000)}`)));
        let defect = false;
        try {
          new HintParser().push(bytesOf('id: 3\nevent: hint\ndata: {"cursor":"1"}\n\n'));
        } catch (error) {
          defect = error instanceof HintStreamDefect;
        }
        assert(defect, "an event with an id is not C4's");
      });
    });

    t.describe("requests the service would call malformed are never built", () => {
      t.it("a body over 256 KiB", () => {
        const bytes = new Uint8Array(MAX_BODY_BYTES / 2);
        assertThrows(() => submitRequest({ kind: "command", bytes }, SPONSORSHIP));
        submitRequest({ kind: "command", bytes: new Uint8Array(1024) }, SPONSORSHIP);
      });

      t.it("a pass with a presentedAt that is not a timestamp", () => {
        assertThrows(() =>
          submitRequest({ kind: "pass", bytes: new Uint8Array(1), presentedAt: -1 }, SPONSORSHIP),
        );
        assertThrows(() =>
          submitRequest({ kind: "pass", bytes: new Uint8Array(1), presentedAt: 1.5 }, SPONSORSHIP),
        );
      });

      t.it("identifiers, tokens, cursors and bounds C4 does not accept", () => {
        assertThrows(() => operationRequest("ABCD" as OperationId, "s1"));
        assertThrows(() => operationRequest(OPERATION, "s 1"));
        assertThrows(() => operationRequest(OPERATION, "s1", -1));
        assertThrows(() => logRequest("a b" as Cursor, 1));
        assertThrows(() => logRequest("" as Cursor, 1001));
        assertThrows(() => queryRequest({ kind: "getEvent", event: EVENT.toUpperCase() } as Query));
        assertThrows(() => queryRequest({ kind: "listTickets" } as unknown as Query));
      });

      t.it("a getCredential with a credential id C4 does not accept", () => {
        const account = "e408f9fc4beb52821ac1b3841f8e0775bf589d150b21a6286603fd767dc8ebf1";
        for (const credential of ["", "0", "AB", "ab".repeat(65)]) {
          assertThrows(() =>
            queryRequest({ kind: "getCredential", account, credential } as unknown as Query),
          );
        }
        queryRequest({ kind: "getCredential", account, credential: "ab".repeat(64) } as Query);
      });

      t.it("a query carries exactly its kind's fields", () => {
        const request = queryRequest({
          kind: "getTicket",
          ticket: TICKET,
          event: EVENT,
        } as unknown as Query);
        assertEqual(request.body, { kind: "getTicket", ticket: TICKET });
      });
    });

    t.it("joins C4's paths to the service URL, and refuses a URL that is not http(s)", async () => {
      const scripted = scriptedFetch([reply(200, { head: "", checkpoint: null })]);
      const client = createC4Client({ url: `${BASE_URL}/ledger//`, fetch: scripted.fetch });
      await client.latestCheckpoint();
      assertEqual(scripted.seen[0]?.url, `${BASE_URL}/ledger/v0/checkpoints/latest`);
      assertThrows(() => createC4Client({ url: "ledger.example", fetch: scripted.fetch }));
    });
  });
};
