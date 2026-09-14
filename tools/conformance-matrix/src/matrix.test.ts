import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discover, runBackend, verdict } from "./matrix.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway workspace: package directory → its `scripts`. */
function workspace(packages: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "conformance-matrix-"));
  roots.push(root);
  for (const [dir, scripts] of Object.entries(packages)) {
    mkdirSync(join(root, "packages", dir), { recursive: true });
    writeFileSync(
      join(root, "packages", dir, "package.json"),
      JSON.stringify({ name: `@ticketto/${dir}`, private: true, scripts }),
    );
  }
  return root;
}

const pass = `node -e "process.exit(0)"`;
const fail = `node -e "console.error('INV-6 failed'); process.exit(1)"`;

describe("discovery", () => {
  it("reports zero backends when no backend runs the suite", () => {
    const root = workspace({
      sdk: {},
      conformance: {},
      "backend-memory": {},
      "binding-offchain": {},
    });
    expect(discover(root)).toEqual({
      registered: [],
      unregistered: ["@ticketto/backend-memory", "@ticketto/binding-offchain"],
    });
  });

  it("registers each backend or binding with a conformance script, and nothing else", () => {
    const root = workspace({
      "backend-memory": { conformance: pass },
      "binding-offchain": { conformance: pass },
      "profile-v0": { conformance: pass },
    });
    expect(discover(root).registered.map((b) => b.name)).toEqual([
      "@ticketto/backend-memory",
      "@ticketto/binding-offchain",
    ]);
  });

  it("finds backend-memory registered in this workspace today (T-005-08)", () => {
    const repo = join(import.meta.dirname, "..", "..", "..");
    expect(discover(repo).registered.map((backend) => backend.name)).toEqual([
      "@ticketto/backend-memory",
    ]);
  });
});

describe("a registered backend's run", () => {
  it("passes when its conformance script passes", () => {
    const root = workspace({ "backend-memory": { conformance: pass } });
    expect(runBackend(root, "@ticketto/backend-memory")).toBe(0);
  });

  it("turns red when its conformance script fails", () => {
    const root = workspace({ "backend-memory": { conformance: fail } });
    expect(runBackend(root, "@ticketto/backend-memory")).not.toBe(0);
  });

  it("turns red for a backend that is not registered", () => {
    const root = workspace({ "backend-memory": {} });
    expect(runBackend(root, "@ticketto/backend-memory")).not.toBe(0);
  });

  it("turns the CLI red when a registered backend fails", () => {
    const cli = join(import.meta.dirname, "..", "dist", "cli.js");
    expect(existsSync(cli), "conformance-matrix is not built; run `pnpm build`").toBe(true);
    const root = workspace({ "binding-offchain": { conformance: fail } });
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, "run", "@ticketto/binding-offchain"], {
        env: { ...process.env, TICKETTO_WORKSPACE_ROOT: root },
        stdio: "pipe",
      });
    } catch (error) {
      ({ status } = error as { status: number });
    }
    expect(status).toBe(1);
  });
});

describe("the overall verdict", () => {
  it("passes with zero backends, when the matrix is skipped", () => {
    expect(verdict("success", 0, "skipped")).toBe(true);
  });

  it("passes when every registered backend passes", () => {
    expect(verdict("success", 2, "success")).toBe(true);
  });

  it("turns red when any registered backend fails", () => {
    expect(verdict("success", 2, "failure")).toBe(false);
  });

  it("turns red when registered backends did not run", () => {
    expect(verdict("success", 1, "skipped")).toBe(false);
    expect(verdict("success", 1, "cancelled")).toBe(false);
  });

  it("turns red when discovery itself failed", () => {
    expect(verdict("failure", 0, "skipped")).toBe(false);
  });
});
