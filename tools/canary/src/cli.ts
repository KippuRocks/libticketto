#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { cleanup, installInClient, packCanary } from "./canary.js";

// Usage: canary [out-dir]
//
// Proves a canary release is installable from a client repository without
// publishing anything: snapshot-version every @ticketto/* package with
// Changesets, `pnpm pack` each, install the tarballs into a throwaway client
// outside the workspace, and import and typecheck every package by name.

const root = resolve(import.meta.dirname, "..", "..", "..");
const outDir = resolve(process.argv[2] ?? join(root, ".canary"));
const tsc = join(
  createRequire(join(root, "package.json")).resolve("typescript/package.json"),
  "..",
  "bin",
  "tsc",
);

const tarballs = await packCanary(root, outDir);
for (const { name, version, path } of tarballs) {
  console.log(`canary: packed ${name}@${version}\n        ${path}`);
}
const client = await installInClient(tarballs, tsc);
console.log(
  `canary: ${tarballs.length} packages installed into ${client}, imported by name and typechecked`,
);
cleanup(client);
