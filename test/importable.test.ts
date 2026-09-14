import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every package must be importable by its name, through its `exports` map, once
// built. Node resolves a package's own name from inside it (self-reference),
// so this exercises exactly the entry point a consumer gets. Requires
// `pnpm build` first.

const root = join(import.meta.dirname, "..");
const packagesDir = join(root, "packages");

const packages = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packagesDir, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")))
  : [];

describe.each(packages)("%s", (dir) => {
  const { name } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    name: string;
  };

  it("is importable by name once built", () => {
    expect(existsSync(join(dir, "dist")), `${name} is not built; run \`pnpm build\``).toBe(true);
    const script = `const m = await import(${JSON.stringify(name)}); process.stdout.write(m.packageName);`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(out).toBe(name);
  });
});
