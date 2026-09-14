// T-007-03 — `TestControls` over a service in test mode (F-010 §5.5; C4.md
// Appendix A; REQ-SDK-7). The clock the suite sets synchronously is the clock
// the service's rules read before the next request. Portable: Node and Hermes.

import { type EventId, INVARIANT_IDS, LOG_START } from "@ticketto/sdk";
import { connectTestOffchainBackend, type TestOffchainBackend } from "../../src/testing/index.js";
import { BASE_URL } from "../fake-fetch.js";
import {
  FakeService,
  type FakeServiceOptions,
  InstantTimers,
  TIMEOUT_MARGIN,
} from "../fake-service.js";
import { assert, assertEqual, assertRejects, assertThrows, type Suite } from "../harness.js";

const ASSURANCE = Object.fromEntries(INVARIANT_IDS.map((id) => [id, "attested"]));
const START = 1_800_000_000_000;

async function connect(
  options: FakeServiceOptions = {},
  seed?: number,
): Promise<{ service: FakeService; backend: TestOffchainBackend }> {
  const service = new FakeService({ assurance: ASSURANCE, clock: START, ...options });
  const connected = await connectTestOffchainBackend({
    url: BASE_URL,
    fetch: service.fetch,
    timers: new InstantTimers(),
    timeoutMargin: TIMEOUT_MARGIN,
    ...(seed === undefined ? {} : { seed }),
  });
  assert(connected.ok, "connects");
  return { service, backend: connected.value };
}

const clockRequests = (service: FakeService) =>
  service.seen
    .filter((s) => s.path === "/v0/testing/clock")
    .map((s) => `${s.method} ${s.body ?? ""}`);

export const testingSuite: Suite = (t) => {
  t.describe("T-007-03 test controls over a service in test mode", () => {
    t.it(
      "the clock starts at the service's, and set and advance reach it before the next request",
      async () => {
        const { service, backend } = await connect();
        assertEqual(backend.clock.now(), START, "read when connecting");
        backend.clock.set(START + 1_000);
        backend.clock.advance(500);
        assertEqual(backend.clock.now(), START + 1_500, "now() answers at once");
        await backend
          .query({ kind: "getEvent", event: "00".repeat(32) as EventId })
          .catch(() => {});
        assertEqual(service.now, START + 1_500, "the service's clock, before the query");
        assertEqual(clockRequests(service), [
          "GET ",
          `POST {"set":${START + 1000}}`,
          'POST {"advance":500}',
        ]);
        const query = service.seen.findIndex((s) => s.path === "/v0/query");
        const lastClock = service.seen.map((s) => s.path).lastIndexOf("/v0/testing/clock");
        assert(lastClock < query, "the clock changes landed before the query was sent");

        backend.clock.advance(10);
        await backend.log.read(LOG_START, 1);
        assertEqual(service.now, START + 1_510, "and before a log read");
      },
    );

    t.it("the clock never moves backwards, and refuses bad values without a request", async () => {
      const { service, backend } = await connect();
      const before = service.seen.length;
      assertThrows(() => backend.clock.set(START - 1), "backwards");
      assertThrows(() => backend.clock.advance(-1), "negative");
      assertThrows(() => backend.clock.set(1.5), "not an integer");
      assertEqual(service.seen.length, before, "no request");
      assertEqual(backend.clock.now(), START);
    });

    t.it("a clock change the service refuses fails the next request loudly", async () => {
      const { service, backend } = await connect();
      service.now = START + 5_000; // The service's clock moved without the test.
      backend.clock.set(START + 1_000);
      await assertRejects(() => backend.log.read(LOG_START, 1), "TestModeError");
    });

    t.it("a service that is not in test mode is refused when connecting", async () => {
      const service = new FakeService({ assurance: ASSURANCE });
      await assertRejects(
        () =>
          connectTestOffchainBackend({
            url: BASE_URL,
            fetch: service.fetch,
            timers: new InstantTimers(),
            timeoutMargin: TIMEOUT_MARGIN,
          }),
        "TestModeError",
      );
    });

    t.it("randomBytes is seeded: the same seed gives the same sequence", async () => {
      const a = await connect({}, 7);
      const b = await connect({}, 7);
      const c = await connect({}, 8);
      const first = a.backend.randomBytes(16);
      assertEqual(first, b.backend.randomBytes(16));
      const other = c.backend.randomBytes(16);
      assert(
        first.some((byte, i) => byte !== other[i]),
        "another seed differs",
      );
      assertEqual(a.backend.randomBytes(5).length, 5);
    });
  });
};
