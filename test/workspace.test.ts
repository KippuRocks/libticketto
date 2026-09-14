import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Workspace conventions every package and tool must keep: ESM only, Node 24
// as the engine floor, TypeScript strict through the shared base config, and
// at least one test of its own.

const root = join(import.meta.dirname, "..");

interface Manifest {
  name?: string;
  type?: string;
  engines?: { node?: string };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function workspaceMembers(): string[] {
  return ["packages", "tools"].flatMap((group) => {
    const dir = join(root, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "package.json")))
      .map((entry) => join(group, entry.name));
  });
}

function hasTestFile(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).some(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".test.ts") &&
      !entry.parentPath.includes("node_modules") &&
      !entry.parentPath.includes("fixtures"),
  );
}

describe("workspace root", () => {
  const manifest = readJson<Manifest>(join(root, "package.json"));

  it("is ESM only", () => {
    expect(manifest.type).toBe("module");
  });

  it("pins Node 24 as the engine floor", () => {
    expect(manifest.engines?.node).toBe(">=24");
  });

  it("keeps the base TypeScript configuration strict", () => {
    const base = readJson<{ compilerOptions: Record<string, unknown> }>(
      join(root, "tsconfig.base.json"),
    );
    expect(base.compilerOptions).toMatchObject({
      strict: true,
      module: "nodenext",
      verbatimModuleSyntax: true,
    });
  });
});

describe.each(workspaceMembers())("%s", (member) => {
  const dir = join(root, member);
  const manifest = readJson<Manifest>(join(dir, "package.json"));

  it("is ESM only", () => {
    expect(manifest.type).toBe("module");
  });

  it("pins Node 24 as the engine floor", () => {
    expect(manifest.engines?.node).toBe(">=24");
  });

  it("extends the base TypeScript configuration", () => {
    const tsconfig = readJson<{ extends?: string }>(join(dir, "tsconfig.json"));
    expect(tsconfig.extends).toMatch(/tsconfig\.base\.json$/);
  });

  it("has at least one test", () => {
    expect(hasTestFile(dir)).toBe(true);
  });
});
