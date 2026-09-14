#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { discover, type JobResult, runBackend, summarise, verdict } from "./matrix.js";

// Usage:
//   conformance-matrix discover            list registered backends; writes
//                                          `backends` and `count` to $GITHUB_OUTPUT
//   conformance-matrix run <package>       run one backend's conformance script
//   conformance-matrix verdict <discovery-result> <count> <matrix-result>

const root = resolve(process.env.TICKETTO_WORKSPACE_ROOT ?? process.cwd());
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "discover": {
    const discovery = discover(root);
    const summary = summarise(discovery);
    console.log(summary);
    const names = discovery.registered.map((b) => b.name);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `backends=${JSON.stringify(names)}\ncount=${names.length}\n`,
      );
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    break;
  }
  case "run": {
    const [name] = args;
    if (name === undefined) {
      console.error("usage: conformance-matrix run <package>");
      process.exitCode = 2;
      break;
    }
    process.exitCode = runBackend(root, name);
    break;
  }
  case "verdict": {
    const [discovery, count, matrix] = args;
    const ok = verdict(discovery as JobResult, Number(count), matrix as JobResult);
    console.log(
      `conformance: discovery ${discovery}, ${count} backend(s), matrix ${matrix} → ${ok ? "pass" : "fail"}`,
    );
    process.exitCode = ok ? 0 : 1;
    break;
  }
  default:
    console.error("usage: conformance-matrix <discover | run <package> | verdict …>");
    process.exitCode = 2;
}
