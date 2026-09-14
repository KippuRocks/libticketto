// Runs the portable suites under the Hermes VM. Bundled by test/hermes/run.ts.
//
// The prelude installs the `TextDecoder` a React Native app provides, which the
// profile's codecs need; nothing installs `crypto.getRandomValues`, which the
// binding does not use. `fetch` and timers are the suites' own; the bare VM has
// no `fetch`.

import "./prelude.js";
// Resolved by test/hermes/run.ts to test/c4/c4-v0.json, published on globalThis.
import "ticketto-c4-vectors";
import { runSuites } from "../harness.js";
import { backendSuite } from "../suites/backend.suite.js";
import { clientSuite } from "../suites/client.suite.js";
import { submitSuite } from "../suites/submit.suite.js";
import { testingSuite } from "../suites/testing.suite.js";
import { translationSuite } from "../suites/translation.suite.js";
import { unavailableSuite } from "../suites/unavailable.suite.js";
import { type C4Vectors, vectorsSuite } from "../suites/vectors.suite.js";

declare const print: (line: string) => void;

const vectors = (globalThis as { __TICKETTO_C4_VECTORS__?: C4Vectors }).__TICKETTO_C4_VECTORS__;

if (vectors === undefined) {
  print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: "no vectors" })}`);
} else {
  runSuites(
    [
      vectorsSuite(vectors),
      clientSuite,
      submitSuite(vectors),
      translationSuite(vectors),
      unavailableSuite(vectors),
      backendSuite(vectors),
      testingSuite,
    ],
    print,
  ).then(
    (summary) => print(`HERMES-SUMMARY ${JSON.stringify(summary)}`),
    (error: unknown) =>
      print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: String(error) })}`),
  );
}
