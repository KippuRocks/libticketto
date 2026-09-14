// Runs every portable suite under the Hermes VM. Bundled by test/hermes/run.ts.

import "./prelude.js";
import { runSuites } from "../harness.js";
import { SUITES } from "../suites/index.js";

declare const print: (line: string) => void;

runSuites(SUITES, print).then(
  (summary) => print(`HERMES-SUMMARY ${JSON.stringify(summary)}`),
  (error: unknown) =>
    print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: String(error) })}`),
);
