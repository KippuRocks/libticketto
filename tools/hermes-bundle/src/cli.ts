#!/usr/bin/env node
import { relative } from "node:path";
import { hermesBundle, PLATFORMS, workspaceRoot } from "./bundle.js";

// The packages that run inside React Native apps (features/001-workspace/plan.md
// §5.3). Each is bundled alone, so a failure names the package that caused it.
export const REACT_NATIVE_PACKAGES = [
  "@ticketto/sdk",
  "@ticketto/profile-v0",
  "@ticketto/binding-offchain",
] as const;

let failed = false;
for (const name of REACT_NATIVE_PACKAGES) {
  const label = name.replace("@ticketto/", "");
  for (const platform of PLATFORMS) {
    try {
      const { bytecode } = await hermesBundle(label, [name], platform);
      console.log(`hermes: ${name} (${platform}) → ${relative(workspaceRoot, bytecode)}`);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`hermes: ${name} (${platform}) failed\n${message}`);
    }
  }
}
process.exitCode = failed ? 1 : 0;
