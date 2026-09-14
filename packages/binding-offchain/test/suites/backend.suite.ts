// T-007-03 — queries, the log reader, hints and assurance over C4 (REQ-SDK-5,
// REQ-SDK-6, AD-17). Done when: a reader from cursor zero matches the service's
// log.
//
// The service is the suites' C4 service in miniature, seeded with the vectors'
// own log entries and fed by real submissions through the port. Portable: Node
// and Hermes.

import {
  type AccountId,
  type Backend,
  type CredentialId,
  type Cursor,
  type EventId,
  INVARIANT_IDS,
  LOG_START,
  type LogRecord,
  type Sponsorship,
  type TicketId,
} from "@ticketto/sdk";
import { connectOffchainBackend, type OffchainBackendOptions } from "../../src/backend.js";
import { fromHex, toHex } from "../../src/hex.js";
import { C4Defect } from "../../src/submit.js";
import { BASE_URL } from "../fake-fetch.js";
import {
  type FakeService,
  type FakeServiceOptions,
  InstantTimers,
  FakeService as Service,
  TIMEOUT_MARGIN,
} from "../fake-service.js";
import { assert, assertEqual, assertRejects, type Suite } from "../harness.js";
import { fixtures } from "./submit.suite.js";
import type { C4Vectors } from "./vectors.suite.js";

const ASSURANCE = Object.fromEntries(
  INVARIANT_IDS.map((id) => [id, id === "INV-6" || id === "INV-7" ? "enforced" : "attested"]),
);

type Json = Record<string, unknown>;

/** JSON of an SDK value: byte strings as hex, as the vectors record them. */
function sdkJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? toHex(v) : v)));
}

interface Connected {
  readonly service: FakeService;
  readonly timers: InstantTimers;
  readonly backend: Backend;
}

async function connect(
  service: FakeServiceOptions = {},
  options: Partial<OffchainBackendOptions> = {},
): Promise<Connected> {
  const timers = new InstantTimers();
  const fake = new Service({ assurance: ASSURANCE, ...service, onHang: () => timers.expire() });
  const connected = await connectOffchainBackend({
    url: BASE_URL,
    fetch: fake.fetch,
    timers,
    timeoutMargin: TIMEOUT_MARGIN,
    ...options,
  });
  assert(connected.ok, "connects");
  return { service: fake, timers, backend: connected.value };
}

/** Every record from `from` to the end of the log, page by page. */
async function readAll(backend: Backend, from: Cursor, limit: number): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  let cursor = from;
  for (;;) {
    const page = await backend.log.read(cursor, limit);
    assert(page.ok, "the page reads");
    if (page.value.records.length === 0) {
      assertEqual(page.value.next, cursor, "an empty page's next is where it was read from");
      return records;
    }
    records.push(...page.value.records);
    cursor = page.value.next;
  }
}

export function backendSuite(vectors: C4Vectors): Suite {
  const f = fixtures(vectors);
  const exchange = (name: string) => {
    const found = vectors.exchanges.find((e) => e.name === name);
    assert(found !== undefined, `no vector named ${name}`);
    return found as typeof found & { decoded?: Json };
  };
  const logPage = exchange("read a log page");
  const pageRecords = (logPage.response as unknown as { body: { records: Json[] } }).body.records;
  const identities = pageRecords.map((r) => {
    const entry = r.entry as { kind: string; bytes: string };
    return `${entry.kind}/${entry.bytes}/${r.presentedAt ?? ""}`;
  });
  const sponsorshipOf = (input: typeof f.transfer): Sponsorship => {
    const sponsorship = f.sponsorships.get(input);
    assert(sponsorship !== undefined);
    return sponsorship;
  };

  return (t) => {
    t.describe("T-007-03 backend over C4", () => {
      t.it("REQ-SDK-5: a reader from cursor zero matches the service's log", async () => {
        const { service, backend } = await connect({ pageSize: 2 });
        for (const identity of identities) service.append(identity);
        const settled = await backend.submit(f.createEvent, sponsorshipOf(f.createEvent));
        assert(settled.ok, "a submission through the port settles");

        const records = await readAll(backend, LOG_START, 3);
        assertEqual(records.length, service.log.length, "every record, across short pages");
        for (const [i, record] of records.entries()) {
          const expected = service.log[i];
          assert(expected !== undefined);
          assertEqual(
            {
              cursor: record.cursor,
              recordedAt: record.recordedAt,
              event: record.event,
              presentedAt: record.presentedAt,
            },
            {
              cursor: expected.cursor,
              recordedAt: expected.recordedAt,
              event: expected.event,
              presentedAt: expected.presentedAt,
            },
            `record ${i}`,
          );
        }
        // The vectors' entries decode to the SDK values the vectors record.
        assertEqual(
          sdkJson(records.slice(0, identities.length).map((r) => r.entry)),
          logPage.decoded?.entries,
          "decoded entries",
        );
        assertEqual(
          settled.value.cursor,
          records[records.length - 1]?.cursor,
          "the receipt's cursor",
        );
      });

      t.it(
        "REQ-SDK-5: reading from any cursor continues after it; past the head, nothing",
        async () => {
          const { service, backend } = await connect();
          for (const identity of identities) service.append(identity);
          const tail = await readAll(backend, "3" as Cursor, 1000);
          assertEqual(
            tail.map((r) => r.cursor),
            ["4", "5"],
          );
          const past = await backend.log.read(service.head as Cursor, 10);
          assertEqual(past, { ok: true, value: { records: [], next: service.head } });
          const big = await backend.log.read(LOG_START, 5_000);
          assert(
            big.ok && big.value.records.length === identities.length,
            "a limit above C4's is served",
          );
          assert(
            service.seen.some((s) => s.path === "/v0/log?from=&limit=1000"),
            "and asked for at most 1000",
          );
        },
      );

      t.it("a cursor the service never issued is a defect, and throws", async () => {
        const { backend } = await connect();
        await assertRejects(() => backend.log.read("99" as Cursor, 1), "C4Defect");
      });

      t.it("ERR-LedgerUnavailable: a read and a query that cannot reach the service", async () => {
        const { service, backend } = await connect({}, { retry: { attempts: 1 } });
        service.inject("drop-before", "drop-before", "drop-before", "drop-before");
        assertEqual(await backend.log.read(LOG_START, 1), {
          ok: false,
          error: { code: "ERR-LedgerUnavailable" },
        });
        assertEqual(await backend.query({ kind: "getEvent", event: "00".repeat(32) as EventId }), {
          ok: false,
          error: { code: "ERR-LedgerUnavailable" },
        });
      });

      t.it(
        "REQ-SDK-1: every query kind answers the SDK's Result, getCredential as bytes",
        async () => {
          const credential = exchange(
            "query getCredential: a credential registered to the account",
          );
          const registered = (credential.request.body as { credential: string }).credential;
          const registration = (
            credential.response as unknown as { body: { result: { value: string } } }
          ).body.result.value;
          const { backend } = await connect({
            query: (q) => {
              switch (q.kind) {
                case "getEvent":
                  return { ok: false, error: { code: "ERR-EventNotFound" } };
                case "canAttend":
                  return { ok: true, value: { admit: false, reason: "ERR-CannotAttend" } };
                case "getCancellationHolder":
                  return { ok: true, value: null };
                case "getCredential":
                  return { ok: true, value: q.credential === registered ? registration : null };
                default:
                  return { ok: false, error: { code: "ERR-TicketNotFound" } };
              }
            },
          });
          const account = (credential.request.body as { account: string }).account as AccountId;
          const ticket = "11".repeat(32) as TicketId;
          const event = "22".repeat(32) as EventId;
          assertEqual(await backend.query({ kind: "getEvent", event }), {
            ok: false,
            error: { code: "ERR-EventNotFound" },
          });
          assertEqual(await backend.query({ kind: "getTicket", ticket }), {
            ok: false,
            error: { code: "ERR-TicketNotFound" },
          });
          assertEqual(await backend.query({ kind: "canAttend", event, ticket }), {
            ok: true,
            value: { admit: false, reason: "ERR-CannotAttend" },
          });
          assertEqual(await backend.query({ kind: "getCancellationHolder", ticket }), {
            ok: true,
            value: null,
          });
          const found = await backend.query({
            kind: "getCredential",
            account,
            credential: registered as CredentialId,
          });
          assert(found.ok && found.value instanceof Uint8Array, "a Registration is bytes");
          assertEqual(found.value, fromHex(registration));
          assertEqual(
            await backend.query({
              kind: "getCredential",
              account,
              credential: "ab" as CredentialId,
            }),
            { ok: true, value: null },
          );
        },
      );

      t.it("a query answered by a defect throws", async () => {
        const { backend } = await connect({
          query: () => ({ ok: false, error: { code: "ERR-UnknownClass" } }),
        });
        await assertRejects(
          () => backend.query({ kind: "getTicket", ticket: "11".repeat(32) as TicketId }),
          "C4Defect",
        );
      });

      t.it("REQ-SDK-6: connecting reads the deployment's assurance declaration", async () => {
        const { backend } = await connect();
        assertEqual(backend.assurance, ASSURANCE);
        const incomplete = new Service({ assurance: { "INV-1": "attested" } });
        let defect: unknown;
        try {
          await connectOffchainBackend({
            url: BASE_URL,
            fetch: incomplete.fetch,
            timers: new InstantTimers(),
            timeoutMargin: TIMEOUT_MARGIN,
          });
        } catch (error) {
          defect = error;
        }
        assert(defect instanceof C4Defect, "a declaration that is not the SDK's is a defect");
      });

      t.it("ERR-LedgerUnavailable: connecting to a service that cannot be reached", async () => {
        const down = new Service({ faults: ["drop-before", "drop-before", "drop-before"] });
        const connected = await connectOffchainBackend({
          url: BASE_URL,
          fetch: down.fetch,
          timers: new InstantTimers(),
          timeoutMargin: TIMEOUT_MARGIN,
          retry: { attempts: 2 },
        });
        assertEqual(connected, { ok: false, error: { code: "ERR-LedgerUnavailable" } });
      });

      t.it(
        "AD-17: streamed hints give the head, then each new head, and close with the reader",
        async () => {
          const { service, backend } = await connect({}, { hints: "events" });
          service.append(identities[0] as string);
          const iterator = backend.log.hints()[Symbol.asyncIterator]();
          assertEqual(await iterator.next(), { done: false, value: "1" });
          const next = iterator.next();
          service.append(identities[1] as string);
          service.append(identities[2] as string);
          assertEqual(await next, { done: false, value: "3" }, "coalesced to the latest head");
          assertEqual(service.openStreams, 1, "one stream open");
          await iterator.return?.();
          assertEqual(service.openStreams, 0, "closed with the reader");
          assertEqual((await iterator.next()).done, true);
        },
      );

      t.it(
        "AD-17: a hint stream that fails reconnects, and its first hint re-establishes the head",
        async () => {
          const { service, backend, timers } = await connect({}, { hints: "events" });
          service.inject("drop-before", { unavailable: 4 });
          service.append(identities[0] as string);
          const iterator = backend.log.hints()[Symbol.asyncIterator]();
          assertEqual(await iterator.next(), { done: false, value: "1" });
          assert(timers.backoffs.includes(4000), "Retry-After honoured before reconnecting");
          await iterator.return?.();
        },
      );

      t.it("AD-17: without a streamed body, hints poll the head (React Native)", async () => {
        const { service, backend, timers } = await connect(
          { streams: false },
          { pollInterval: 750 },
        );
        service.append(identities[0] as string);
        const iterator = backend.log.hints()[Symbol.asyncIterator]();
        assertEqual(await iterator.next(), { done: false, value: "1" });
        service.append(identities[1] as string);
        assertEqual(await iterator.next(), { done: false, value: "2" });
        assert(timers.backoffs.includes(750), "polled at the interval");
        assert(
          service.seen.filter((s) => s.path === "/v0/log/hints").length === 1,
          "the stream was tried once",
        );
        await iterator.return?.();

        const polling = await connect({ streams: false }, { hints: "poll" });
        polling.service.append(identities[0] as string);
        const polled = polling.backend.log.hints()[Symbol.asyncIterator]();
        assertEqual(await polled.next(), { done: false, value: "1" });
        assert(
          !polling.service.seen.some((s) => s.path === "/v0/log/hints"),
          "poll never opens the stream",
        );
        await polled.return?.();

        const streaming = await connect({ streams: false }, { hints: "events" });
        await assertRejects(
          () => streaming.backend.log.hints()[Symbol.asyncIterator]().next(),
          "HintStreamUnsupported",
        );
      });
    });
  };
}
