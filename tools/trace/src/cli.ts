#!/usr/bin/env node
// ticketto-trace — features/004-conformance/plan.md §5.5.
//
// Usage:
//   ticketto-trace --spec <SPEC.md> --scope v0 --results <file>... [--allow <file>]
//
// --spec     The SPEC.md to trace against, at the commit the repository pins.
// --scope    The release scope. Only `v0` exists.
// --results  One or more Vitest JSON or JUnit XML result files, from any repository.
// --allow    A file of identifiers this repository is not yet required to cover, one per
//            line; `#` starts a comment.
//
// Exits 0 when every required identifier has a test and no test names an undefined or
// tombstoned identifier; 1 when not; 2 on a usage error.

import { readFileSync } from "node:fs";
import { SCOPE_V0 } from "@ticketto/conformance";
import { readTitles, type TestTitle } from "./results.js";
import { parseSpecIds } from "./spec.js";
import { trace } from "./trace.js";

const SCOPES = { v0: SCOPE_V0 } as const;

function usage(message: string): never {
  console.error(`ticketto-trace: ${message}`);
  console.error(
    "usage: ticketto-trace --spec <SPEC.md> --scope v0 --results <file>... [--allow <file>]",
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]) {
  let spec: string | undefined;
  let scope: string | undefined;
  let allow: string | undefined;
  const results: string[] = [];
  let collecting = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) usage(`${arg} needs a value`);
      return next;
    };
    if (arg === "--spec") {
      spec = value();
      collecting = false;
    } else if (arg === "--scope") {
      scope = value();
      collecting = false;
    } else if (arg === "--allow") {
      allow = value();
      collecting = false;
    } else if (arg === "--results") {
      results.push(value());
      collecting = true;
    } else if (collecting && !arg.startsWith("--")) {
      results.push(arg);
    } else {
      usage(`unknown argument ${arg}`);
    }
  }
  if (spec === undefined) usage("--spec is required");
  if (scope === undefined) usage("--scope is required");
  if (results.length === 0) usage("--results needs at least one file");
  if (!Object.hasOwn(SCOPES, scope)) usage(`unknown scope ${scope}; only "v0" exists`);
  return { spec, scope: scope as keyof typeof SCOPES, results, allow };
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`ticketto-trace: cannot read ${path}: ${(error as Error).message}`);
    process.exit(2);
  }
}

const args = parseArgs(process.argv.slice(2));
try {
  const titles: TestTitle[] = args.results.flatMap((path) => readTitles(read(path), path));
  const allow =
    args.allow === undefined
      ? []
      : read(args.allow)
          .split(/\r?\n/)
          .map((line) => line.replace(/#.*$/, "").trim())
          .filter((line) => line !== "");
  const report = trace({
    spec: parseSpecIds(read(args.spec)),
    scope: SCOPES[args.scope],
    titles,
    allow,
  });
  for (const problem of report.problems) console.error(`ticketto-trace: ${problem}`);
  console.log(
    `ticketto-trace: ${report.covered.length} of ${report.required.length} required identifiers covered by ${titles.length} tests; ${report.problems.length} problem(s)`,
  );
  process.exitCode = report.problems.length === 0 ? 0 : 1;
} catch (error) {
  console.error(`ticketto-trace: ${(error as Error).message}`);
  process.exitCode = 2;
}
