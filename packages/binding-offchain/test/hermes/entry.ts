// Runs the portable suites under the Hermes VM. Bundled by test/hermes/run.ts.
//
// No prelude: unlike `profile-v0`, the client needs neither `TextDecoder` nor
// `crypto.getRandomValues`, and running without them is part of what this proves.
// `fetch` is the suites' scripted one; the bare VM has none.

// Resolved by test/hermes/run.ts to test/c4/c4-v0.json, published on globalThis.
import "ticketto-c4-vectors";
import { runSuites } from "../harness.js";
import { clientSuite } from "../suites/client.suite.js";
import { type C4Vectors, vectorsSuite } from "../suites/vectors.suite.js";

declare const print: (line: string) => void;

const vectors = (globalThis as { __TICKETTO_C4_VECTORS__?: C4Vectors }).__TICKETTO_C4_VECTORS__;

if (vectors === undefined) {
  print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: "no vectors" })}`);
} else {
  runSuites([vectorsSuite(vectors), clientSuite], print).then(
    (summary) => print(`HERMES-SUMMARY ${JSON.stringify(summary)}`),
    (error: unknown) =>
      print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: String(error) })}`),
  );
}
