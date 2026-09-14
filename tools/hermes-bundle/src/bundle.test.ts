import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hermesBundle, projectRoot, workspaceRoot } from "./bundle.js";

// Metro and hermesc are slow compared with unit tests.
const TIMEOUT = 120_000;

const sdkDist = join(workspaceRoot, "packages", "sdk", "dist");

/**
 * A copy of the built `@ticketto/sdk` with `addition` appended to its entry
 * point — what the Hermes job sees if someone adds that code to `sdk`.
 */
function sdkWith(name: string, addition: string): string {
  expect(existsSync(sdkDist), "@ticketto/sdk is not built; run `pnpm build`").toBe(true);
  const dir = join(projectRoot, ".hermes", "fixtures", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(sdkDist, join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.js"), `\n${addition}\n`, { flag: "a" });
  return `../fixtures/${name}/dist/index.js`;
}

describe("the React Native path", () => {
  it(
    "bundles sdk, profile-v0 and binding-offchain and compiles them to Hermes bytecode",
    async () => {
      const { bytecode } = await hermesBundle("rn-path", [
        "@ticketto/sdk",
        "@ticketto/profile-v0",
        "@ticketto/binding-offchain",
      ]);
      expect(existsSync(bytecode)).toBe(true);
    },
    TIMEOUT,
  );
});

describe("a Node-only API added to sdk", () => {
  it(
    "fails the Hermes bundle when sdk imports a node: built-in",
    async () => {
      const entry = sdkWith(
        "node-prefixed",
        `import { readFileSync } from "node:fs";\nexport const read = readFileSync;`,
      );
      await expect(hermesBundle("node-prefixed", [entry])).rejects.toThrow(
        /Unable to resolve module node:fs/,
      );
    },
    TIMEOUT,
  );

  it(
    "fails the Hermes bundle when sdk imports a bare built-in",
    async () => {
      const entry = sdkWith(
        "node-bare",
        `import { createHash } from "crypto";\nexport const hash = createHash;`,
      );
      await expect(hermesBundle("node-bare", [entry])).rejects.toThrow(
        /Unable to resolve module crypto/,
      );
    },
    TIMEOUT,
  );
});
