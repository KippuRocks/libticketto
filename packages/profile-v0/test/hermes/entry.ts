// Runs every portable suite under the Hermes VM. Bundled by test/hermes/run.ts.

import "./prelude.js";
// Resolved by test/hermes/run.ts to vectors/v0.json, published on globalThis.
import "ticketto-vectors";
import { runSuites } from "../harness.js";
import { SUITES } from "../suites/index.js";
import { vectorsSuite } from "../vectors/vectors.js";

declare const print: (line: string) => void;

const vectors = (globalThis as { __TICKETTO_VECTORS__?: unknown }).__TICKETTO_VECTORS__;

runSuites([...SUITES, vectorsSuite(vectors)], print).then(
  (summary) => print(`HERMES-SUMMARY ${JSON.stringify(summary)}`),
  (error: unknown) =>
    print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: String(error) })}`),
);
