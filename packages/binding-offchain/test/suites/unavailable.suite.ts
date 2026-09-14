// T-007-07 — the unavailability rejection (REQ-SDK-2; amendment 0003 G8). Done
// when: exhausted retries reject with the ruled code.
//
// Every row of C4.md §4.3 that retries — a transport failure, a timeout, `503`,
// a proxy's `5xx`, a resubmission — is driven past the budget, before and after
// `submitted`, and must end in `ERR-LedgerUnavailable` with no detail. Progress
// refills the budget; reads spend their own. Portable: Node and Hermes.

import type { Sponsorship, SubmitInput } from "@ticketto/sdk";
import { createC4Client } from "../../src/client.js";
import { createRetrier, LEDGER_UNAVAILABLE } from "../../src/retry.js";
import { BASE_URL, type ScriptedResponse, scriptedFetch } from "../fake-fetch.js";
import { type Fault, InstantTimers } from "../fake-service.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { complete, fixtures, setUp } from "./submit.suite.js";
import type { C4Vectors } from "./vectors.suite.js";

const RETRY = { attempts: 5, initialDelay: 250, maxDelay: 2_000 };
const REJECTED = { state: "rejected", error: { code: "ERR-LedgerUnavailable" } };

function times(count: number, fault: Fault): Fault[] {
  return Array.from({ length: count }, () => fault);
}

export function unavailableSuite(vectors: C4Vectors): Suite {
  const f = fixtures(vectors);
  const sponsorshipOf = (input: SubmitInput): Sponsorship => {
    const sponsorship = f.sponsorships.get(input);
    assert(sponsorship !== undefined, "no sponsorship for this input");
    return sponsorship;
  };

  /** Submits against `faults` and checks the submission ends in G8's rejection alone. */
  async function exhausts(faults: Fault[], expectedStates: unknown[]) {
    const run = setUp({ faults, retry: RETRY });
    const { states, result } = await complete(run.submit(f.transfer, sponsorshipOf(f.transfer)));
    assertEqual(states, expectedStates, "states");
    assertEqual(result, { ok: false, error: { code: "ERR-LedgerUnavailable" } }, "result");
    assertEqual(run.service.recorded.length, 0, "state changes");
    return run;
  }

  return (t) => {
    t.describe("T-007-07 unavailability", () => {
      t.it(
        "ERR-LedgerUnavailable: a connection that never comes back, once the budget is spent",
        async () => {
          const run = await exhausts(times(20, "drop-before"), [REJECTED]);
          assertEqual(run.service.seen.length, RETRY.attempts + 1, "requests");
          assertEqual(
            run.timers.backoffs,
            [250, 500, 1000, 2000, 2000],
            "backoffs double to the ceiling",
          );
        },
      );

      t.it("ERR-LedgerUnavailable: responses lost after the service handled them", async () => {
        const run = await exhausts(times(20, "drop-after"), [REJECTED]);
        assertEqual(new Set(run.service.submits).size, 1, "every retry was the identical request");
      });

      t.it(
        "ERR-LedgerUnavailable: 503 throughout, never retried sooner than Retry-After",
        async () => {
          const run = await exhausts(times(20, { unavailable: 3 }), [REJECTED]);
          assertEqual(run.timers.backoffs, [3000, 3000, 3000, 3000, 3000], "backoffs");
        },
      );

      t.it("ERR-LedgerUnavailable: a proxy's 5xx throughout", async () => {
        await exhausts(times(20, "bad-gateway"), [REJECTED]);
      });

      t.it("ERR-LedgerUnavailable: requests that hang until their timeout", async () => {
        const run = await exhausts(times(20, "hang"), [REJECTED]);
        assertEqual(run.service.seen.length, RETRY.attempts + 1, "requests");
      });

      t.it("ERR-LedgerUnavailable: a submitted write whose polls keep failing", async () => {
        const faults: Fault[] = ["none", ...times(20, "drop-before")];
        await exhausts(faults, [
          { state: "submitted", operationId: operationOf(f.transfer) },
          REJECTED,
        ]);
      });

      t.it("ERR-LedgerUnavailable: a service that keeps forgetting the submission", async () => {
        const faults: Fault[] = [];
        for (let i = 0; i < 20; i++) faults.push("none", "restart");
        const run = await exhausts(faults, [
          { state: "submitted", operationId: operationOf(f.transfer) },
          REJECTED,
        ]);
        assertEqual(new Set(run.service.submits).size, 1, "every resubmission was identical");
      });

      t.it("ERR-LedgerUnavailable: a budget of zero rejects at the first failure", async () => {
        const run = setUp({ faults: ["drop-before"], retry: { attempts: 0 } });
        const { states } = await complete(run.submit(f.transfer, sponsorshipOf(f.transfer)));
        assertEqual(states, [REJECTED]);
        assertEqual(run.timers.backoffs, [], "no backoff");
      });

      t.it(
        "progress refills the budget: failures between pending polls never exhaust it",
        async () => {
          // The 202 is not progress by itself; each pending poll is.
          const faults: Fault[] = ["none"];
          for (let i = 0; i < 7; i++) faults.push("drop-before", "drop-before", "none");
          const run = setUp({ faults, pendingPolls: 6, retry: { attempts: 2 } });
          const result = await run.submit(f.transfer, sponsorshipOf(f.transfer));
          assert(result.ok, "the write settles");
          assertEqual(run.service.recorded.length, 1, "state changes");
        },
      );

      t.it(
        "ERR-LedgerUnavailable: a read spends its own budget, and a read that recovers answers",
        async () => {
          const unavailable: ScriptedResponse = {
            status: 503,
            headers: { "content-type": "application/json; charset=utf-8" },
            text: '{"error":{"code":"unavailable"}}',
          };
          const assurance: ScriptedResponse = {
            status: 200,
            text: '{"assurance":{}}',
          };
          const timers = new InstantTimers();
          const retrier = createRetrier({ retry: { attempts: 2 }, timers });

          const down = scriptedFetch([unavailable, { transport: "reset" }, unavailable, assurance]);
          const downClient = createC4Client({ url: BASE_URL, fetch: down.fetch });
          const failed = await retrier.read(
            (signal) => downClient.latestCheckpoint(signal === undefined ? {} : { signal }),
            3_600_000,
          );
          assertEqual(failed, { outcome: "unavailable", error: { code: "ERR-LedgerUnavailable" } });
          assertEqual(down.seen.length, 3, "requests");

          const flaky = scriptedFetch([
            unavailable,
            { status: 200, text: '{"head":"4","checkpoint":null}' },
          ]);
          const flakyClient = createC4Client({ url: BASE_URL, fetch: flaky.fetch });
          const recovered = await retrier.read(
            (signal) => flakyClient.latestCheckpoint(signal === undefined ? {} : { signal }),
            3_600_000,
          );
          assertEqual(recovered, { outcome: "value", value: { head: "4", checkpoint: null } });

          const broken = scriptedFetch([assurance]);
          const brokenClient = createC4Client({ url: BASE_URL, fetch: broken.fetch });
          const defect = await retrier.read(
            (signal) => brokenClient.assurance(signal === undefined ? {} : { signal }),
            3_600_000,
          );
          assertEqual(defect.outcome, "defect", "a defect is returned, never retried");
          assertEqual(broken.seen.length, 1, "requests");
        },
      );

      t.it("ERR-LedgerUnavailable carries no backend detail (REQ-SDK-2)", () => {
        assertEqual(Object.keys(LEDGER_UNAVAILABLE), ["code"]);
        assert(Object.isFrozen(LEDGER_UNAVAILABLE), "shared, so frozen");
      });
    });
  };
}

function operationOf(input: SubmitInput): string {
  return input.kind === "command" ? input.signed.command.operationId : input.signed.pass.id;
}
