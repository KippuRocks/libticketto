/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testingSuite } from "../../test/suites/testing.suite.js";

testingSuite({ describe, it });

describe("T-003-07 the /testing entry point", () => {
  const root = join(import.meta.dirname, "..", "..");

  it("is importable by name once built, and the main entry point exports no signer", () => {
    expect(existsSync(join(root, "dist", "testing", "index.js")), "run `pnpm build`").toBe(true);
    const script = [
      'const testing = await import("@ticketto/profile-v0/testing");',
      'const main = await import("@ticketto/profile-v0");',
      "process.stdout.write(JSON.stringify([Object.keys(testing).sort(), Object.keys(main)]));",
    ].join("");
    const [testing, main] = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as [string[], string[]];
    expect(testing).toEqual([
      "SimulatedWebAuthnAuthenticator",
      "simulatedWebAuthnSigner",
      "softwareP256Signer",
    ]);
    expect(main.filter((name) => /signer|simulated|software/i.test(name))).toEqual([]);
  });
});
