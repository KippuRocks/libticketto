#!/usr/bin/env node
import { resolve } from "node:path";
import { checkWorkspace, format } from "./check.js";

// Usage: switch-default [workspace-root]
// Exits 1 on a switch over Command kinds or TickettoErrorCode with no default.

const root = resolve(process.argv[2] ?? process.cwd());
const violations = checkWorkspace(root);
const output = format(violations);
if (violations.length > 0) {
  console.error(output);
  process.exitCode = 1;
} else {
  console.log(output);
}
