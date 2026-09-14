#!/usr/bin/env node
import { resolve } from "node:path";
import { checkWorkspace, format } from "./check.js";

// Usage: ticketto-boundaries [workspace-root]
// Exits 1 on any violation of features/001-workspace/plan.md §5.2.

const root = resolve(process.argv[2] ?? process.cwd());
const report = checkWorkspace(root);
const output = format(report);
if (report.violations.length > 0) {
  console.error(output);
  process.exitCode = 1;
} else {
  console.log(output);
}
