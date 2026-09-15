// T-004-11: the mutation check (REQ-SDK-7; features/004-conformance/plan.md §5.2b,
// §7). The suite must detect a backend with one rule removed, not merely pass a
// correct one. This builds backend-memory with INV-6's single-use rule removed —
// its store never reports a pass consumed, so a consumed pass is accepted again —
// and asserts that the INV-6 suite fails against it while an unrelated suite
// still passes.
//
// Test-only: the mutated store exists here and nowhere in the shipped package.

import {
  type ConformanceTest,
  collectTests,
  profileV0Fixtures,
  runsThrough,
  runTest,
  type TestBackend,
  V0_SUITES,
} from "@ticketto/conformance";
import {
  DEFAULT_MAX_CLOCK_SKEW,
  DEFAULT_MAX_PASS_WINDOW,
  DEFAULT_MAX_RECORDING_LAG,
  type Registry,
} from "@ticketto/ledger-rules";
import type { OperationId, PassId } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { backendOver } from "../src/backend.js";
import { createMemoryStore, type MemoryStore } from "../src/capabilities.js";
import {
  type ControlledClock,
  createControlledClock,
  seededRandomBytes,
} from "../src/testing/index.js";

const fixtures = profileV0Fixtures();

/**
 * A store with INV-6's rule removed: inside a transaction, no pass is ever
 * consumed, and the operation a pass's consumption records is never found.
 */
function withoutSingleUse(store: MemoryStore): MemoryStore {
  const caps = store.capabilities;
  const consumed = new Set<string>();
  const forgetful = (tx: Registry): Registry =>
    new Proxy(tx, {
      get(target, property, receiver) {
        switch (property) {
          case "isPassConsumed":
            return async () => false;
          case "recordConsumedPass":
            return async (...args: Parameters<Registry["recordConsumedPass"]>) => {
              consumed.add(args[1]);
              return target.recordConsumedPass(...args);
            };
          case "getOperation":
            return async (id: OperationId) =>
              consumed.has(id as string as PassId) ? null : target.getOperation(id);
          default: {
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          }
        }
      },
    });
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "capabilities") return Reflect.get(target, property, receiver);
      return new Proxy(caps, {
        get(capTarget, capProperty, capReceiver) {
          if (capProperty === "transaction") {
            return <T>(fn: (tx: Registry) => Promise<T>) =>
              capTarget.transaction((tx) => fn(forgetful(tx)));
          }
          return Reflect.get(capTarget, capProperty, capReceiver);
        },
      });
    },
  });
}

/** backend-memory under test controls, over a given store. */
function testBackend(store: MemoryStore, clock: ControlledClock): TestBackend {
  const backend = backendOver(store, fixtures.profile);
  return {
    submit: (input, sponsorship) => backend.submit(input, sponsorship),
    query: (q) => backend.query(q),
    log: backend.log,
    assurance: backend.assurance,
    clock,
    randomBytes: seededRandomBytes(0),
    maxRecordingLag: DEFAULT_MAX_RECORDING_LAG,
    maxClockSkew: DEFAULT_MAX_CLOCK_SKEW,
    maxPassWindow: DEFAULT_MAX_PASS_WINDOW,
  };
}

/** Runs each test, returning the titles of those that failed. */
async function failing(mutated: boolean, tests: readonly ConformanceTest[]): Promise<string[]> {
  const failed: string[] = [];
  const reasons: string[] = [];
  for (const test of tests) {
    const target = {
      name: mutated ? "backend-memory without INV-6's rule" : "backend-memory",
      makeBackend: async () => {
        const clock = createControlledClock();
        const store = createMemoryStore({ clock });
        return testBackend(mutated ? withoutSingleUse(store) : store, clock);
      },
      ...fixtures,
    };
    try {
      await runTest(target, test);
    } catch (error) {
      failed.push(test.title);
      reasons.push(`${test.title}: ${String(error)}`);
    }
  }
  lastReasons = reasons;
  return failed;
}

/** Why the tests of the last `failing` call failed, for the assertion messages. */
let lastReasons: readonly string[] = [];

const through = "M3" as const;
const tests = collectTests(V0_SUITES).filter((test) => runsThrough(test.milestone, through));
/** The matching identifier's tests: INV-6, without the 1,000-run concurrency variant. */
const singleUse = tests.filter(
  (test) => test.suite === "INV-6" && test.options.timeout === undefined,
);
const unrelated = tests.filter((test) => test.suite === "ERR-CapacityExceeded");

describe("mutation check: backend-memory with INV-6's single-use rule removed", () => {
  it("REQ-SDK-7: the INV-6 suite passes against backend-memory as built", async () => {
    expect(singleUse.length).toBeGreaterThan(0);
    expect(await failing(false, singleUse)).toEqual([]);
  });

  it("REQ-SDK-7: the INV-6 suite fails against the backend with the rule removed", async () => {
    const failed = await failing(true, singleUse);
    // It fails on an assertion about the backend's behaviour, not in the harness.
    expect(lastReasons.every((reason) => reason.includes("AssertionError"))).toBe(true);
    expect(failed).toContain(
      "INV-6: a consumed pass is not consumed again, however it is resubmitted",
    );
  });

  it("REQ-SDK-7: the removal is targeted — an unrelated suite still passes", async () => {
    expect(unrelated.length).toBeGreaterThan(0);
    expect(await failing(true, unrelated)).toEqual([]);
  });
});
