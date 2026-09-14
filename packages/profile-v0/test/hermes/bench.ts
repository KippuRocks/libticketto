// T-003-09 under the Hermes VM: prints one `BENCH` line per credential kind.

import "./prelude.js";
import { runPassBenchmark } from "../bench/pass.bench.js";

declare const print: (line: string) => void;

runPassBenchmark({ now: () => Date.now(), iterations: 300, warmup: 30 }).then(
  (results) => {
    for (const result of results)
      print(`BENCH ${JSON.stringify({ runtime: "hermes", ...result })}`);
    print(`HERMES-SUMMARY ${JSON.stringify({ passed: results.length, failed: 0 })}`);
  },
  (error: unknown) =>
    print(`HERMES-SUMMARY ${JSON.stringify({ passed: 0, failed: 1, error: String(error) })}`),
);
