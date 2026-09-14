import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkWorkspace, type Report } from "./check.js";

interface FakePackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: Record<string, string>;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Builds a throwaway workspace: package directory → manifest and files. */
function workspace(packages: Record<string, FakePackage>): string {
  const root = mkdtempSync(join(tmpdir(), "boundaries-"));
  roots.push(root);
  for (const [dir, { files = {}, ...deps }] of Object.entries(packages)) {
    const base = join(root, "packages", dir);
    mkdirSync(base, { recursive: true });
    writeFileSync(
      join(base, "package.json"),
      JSON.stringify({ name: `@ticketto/${dir}`, type: "module", ...deps }),
    );
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), content);
    }
  }
  return root;
}

const src = (code: string) => ({ files: { "src/index.ts": code } });
const reasons = (report: Report) => report.violations.map((v) => `${v.to}: ${v.reason}`);

describe("a workspace keeping every §5.2 rule", () => {
  it("has no violations", () => {
    const root = workspace({
      sdk: src(`import { x } from "@noble/hashes"; export const y = x;`),
      "profile-v0": {
        dependencies: { "@ticketto/sdk": "workspace:*" },
        ...src(`import type { Sdk } from "@ticketto/sdk"; export type { Sdk };`),
      },
      "ledger-rules": {
        dependencies: { "@ticketto/sdk": "workspace:*", "@ticketto/profile-v0": "workspace:*" },
        ...src(
          `import type { Sdk } from "@ticketto/sdk";\nexport type * from "@ticketto/sdk";\nimport { p } from "@ticketto/profile-v0";\ntype T = import("@ticketto/sdk").Surface;`,
        ),
      },
      "backend-memory": {
        dependencies: {
          "@ticketto/sdk": "workspace:*",
          "@ticketto/ledger-rules": "workspace:*",
          "@ticketto/log": "workspace:*",
        },
        devDependencies: { "@ticketto/conformance": "workspace:*" },
        files: {
          "src/index.ts": `import "@ticketto/sdk"; import "@ticketto/ledger-rules"; import "@ticketto/log"; import { readFileSync } from "node:fs";`,
          "src/conformance.test.ts": `import { suite } from "@ticketto/conformance";`,
        },
      },
      "binding-offchain": {
        dependencies: { "@ticketto/sdk": "workspace:*", "@ticketto/profile-v0": "workspace:*" },
        ...src(`export * from "@ticketto/sdk"; const p = await import("@ticketto/profile-v0");`),
      },
      conformance: {
        dependencies: { "@ticketto/sdk": "workspace:*", "@ticketto/profile-v0": "workspace:*" },
        ...src(
          `import "@ticketto/sdk/errors"; import "@ticketto/profile-v0"; import "./local.js";`,
        ),
      },
      log: src(`import "@ticketto/backend-memory";`),
      rx: src(`import "rxjs";`),
    });
    const report = checkWorkspace(root);
    expect(reasons(report)).toEqual([]);
    expect(report.checked).toHaveLength(6);
    expect([...report.unruled].sort()).toEqual(["@ticketto/log", "@ticketto/rx"]);
  });
});

describe("sdk", () => {
  it("fails on a deliberate sdk → backend-memory import", () => {
    const root = workspace({
      sdk: src(`import { MemoryBackend } from "@ticketto/backend-memory";`),
      "backend-memory": src(""),
    });
    expect(checkWorkspace(root).violations).toEqual([
      {
        from: "@ticketto/sdk",
        to: "@ticketto/backend-memory",
        where: join("packages", "sdk", "src", "index.ts"),
        reason: "@ticketto/sdk must never depend on any backend",
      },
    ]);
  });

  it("fails the CLI with exit code 1 on that import", () => {
    const cli = join(import.meta.dirname, "..", "dist", "cli.js");
    expect(existsSync(cli), "boundaries is not built; run `pnpm build`").toBe(true);
    const root = workspace({ sdk: src(`import "@ticketto/backend-memory";`) });
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [cli, root], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      ({ status, stderr } = error as { status: number; stderr: string });
    }
    expect(status).toBe(1);
    expect(stderr).toContain("@ticketto/sdk → @ticketto/backend-memory");
  });

  it("fails on any future backend or binding", () => {
    const root = workspace({ sdk: src(`import "@ticketto/binding-kreivo";`) });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/binding-kreivo: @ticketto/sdk must never depend on any backend",
    ]);
  });

  it("fails on a declared dependency even with no import", () => {
    const root = workspace({ sdk: { dependencies: { "@ticketto/profile-v0": "workspace:*" } } });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/profile-v0: @ticketto/sdk must never depend on @ticketto/profile-v0",
    ]);
  });

  it("fails on a subpath import, a dynamic import, a require and a re-export", () => {
    const root = workspace({
      sdk: src(
        [
          `import "@ticketto/ledger-rules/engine";`,
          `const m = await import("@ticketto/backend-memory");`,
          `const r = require("@ticketto/binding-offchain");`,
          `export * from "@ticketto/profile-v0";`,
        ].join("\n"),
      ),
    });
    expect(checkWorkspace(root).violations.map((v) => v.to)).toEqual([
      "@ticketto/ledger-rules",
      "@ticketto/backend-memory",
      "@ticketto/binding-offchain",
      "@ticketto/profile-v0",
    ]);
  });

  it("fails on a relative import that escapes the package", () => {
    const root = workspace({ sdk: src(`import "../../backend-memory/src/index.js";`) });
    expect(reasons(checkWorkspace(root))).toEqual([
      `${join("packages", "backend-memory", "src", "index.js")}: relative import escapes the package; depend on packages by name`,
    ]);
  });

  it("fails on a forbidden import in a test file too", () => {
    const root = workspace({
      sdk: { files: { "src/index.test.ts": `import "@ticketto/backend-memory";` } },
    });
    expect(checkWorkspace(root).violations).toHaveLength(1);
  });
});

describe("profile-v0 — sdk for types only", () => {
  it("fails on a value import of sdk", () => {
    const root = workspace({ "profile-v0": src(`import { surface } from "@ticketto/sdk";`) });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/sdk: @ticketto/profile-v0 may depend on @ticketto/sdk for types only; use `import type` or `export type`",
    ]);
  });

  it("fails on inline type specifiers, which still emit an import", () => {
    const root = workspace({ "profile-v0": src(`import { type Surface } from "@ticketto/sdk";`) });
    expect(checkWorkspace(root).violations).toHaveLength(1);
  });

  it("fails on a runtime re-export of sdk", () => {
    const root = workspace({ "profile-v0": src(`export * from "@ticketto/sdk";`) });
    expect(checkWorkspace(root).violations).toHaveLength(1);
  });

  it("fails on a backend", () => {
    const root = workspace({
      "profile-v0": src(`import type { M } from "@ticketto/backend-memory";`),
    });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/backend-memory: @ticketto/profile-v0 must never depend on any backend",
    ]);
  });
});

describe("ledger-rules — no backend, no I/O", () => {
  it("fails on Node.js built-ins, with or without the node: prefix", () => {
    const root = workspace({
      "ledger-rules": src(`import { readFile } from "node:fs/promises";\nimport net from "net";`),
    });
    expect(reasons(checkWorkspace(root))).toEqual([
      "node:fs/promises: @ticketto/ledger-rules must never perform I/O (Node.js built-in)",
      "net: @ticketto/ledger-rules must never perform I/O (Node.js built-in)",
    ]);
  });

  it("fails on an internal package outside its allowance", () => {
    const root = workspace({ "ledger-rules": src(`import "@ticketto/log";`) });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/log: @ticketto/ledger-rules may depend only on: @ticketto/sdk, @ticketto/profile-v0",
    ]);
  });
});

describe("backend-memory", () => {
  it("fails on binding-offchain", () => {
    const root = workspace({
      "backend-memory": { devDependencies: { "@ticketto/binding-offchain": "workspace:*" } },
    });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/binding-offchain: @ticketto/backend-memory must never depend on @ticketto/binding-offchain",
    ]);
  });
});

describe("binding-offchain — a client binding cannot enforce (AD-25)", () => {
  it("fails on ledger-rules and backend-memory", () => {
    const root = workspace({
      "binding-offchain": src(
        `import "@ticketto/ledger-rules";\nimport "@ticketto/backend-memory";`,
      ),
    });
    expect(reasons(checkWorkspace(root))).toEqual([
      "@ticketto/ledger-rules: @ticketto/binding-offchain must never depend on @ticketto/ledger-rules",
      "@ticketto/backend-memory: @ticketto/binding-offchain must never depend on @ticketto/backend-memory",
    ]);
  });
});

describe("conformance — backends are injected", () => {
  it("fails on a concrete backend, even as a devDependency or from a test", () => {
    const root = workspace({
      conformance: {
        devDependencies: { "@ticketto/backend-memory": "workspace:*" },
        files: { "test/suite.test.ts": `import "@ticketto/binding-offchain";` },
      },
    });
    expect(checkWorkspace(root).violations.map((v) => v.to)).toEqual([
      "@ticketto/backend-memory",
      "@ticketto/binding-offchain",
    ]);
  });
});
