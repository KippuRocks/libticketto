import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A backend package is `@ticketto/backend-*` or `@ticketto/binding-*`. It is
// *registered* for conformance once it defines a `conformance` script in its
// package.json — the command that runs `@ticketto/conformance` against itself
// and exits non-zero when the suite fails. How the backend is handed to the
// suite belongs to the conformance feature; CI only needs the script.

export const SCRIPT = "conformance";

export interface Backend {
  readonly name: string;
  readonly dir: string;
}

export interface Discovery {
  /** Backends with a `conformance` script: each gets one CI run. */
  readonly registered: readonly Backend[];
  /** Backend packages that exist but do not run the suite yet. */
  readonly unregistered: readonly string[];
}

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
}

export function isBackend(name: string): boolean {
  return name.startsWith("@ticketto/backend-") || name.startsWith("@ticketto/binding-");
}

export function discover(root: string): Discovery {
  const packagesDir = join(root, "packages");
  const registered: Backend[] = [];
  const unregistered: string[] = [];
  if (!existsSync(packagesDir)) return { registered, unregistered };

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, "package.json");
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (!isBackend(manifest.name)) continue;
    if (manifest.scripts?.[SCRIPT] === undefined) unregistered.push(manifest.name);
    else registered.push({ name: manifest.name, dir });
  }
  registered.sort((a, b) => a.name.localeCompare(b.name));
  unregistered.sort();
  return { registered, unregistered };
}

export function summarise({ registered, unregistered }: Discovery): string {
  const lines = [
    `conformance: ${registered.length} backend(s) registered${
      registered.length > 0 ? `: ${registered.map((b) => b.name).join(", ")}` : ""
    }`,
  ];
  if (unregistered.length > 0) {
    lines.push(
      `conformance: not yet registered (no "${SCRIPT}" script): ${unregistered.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** Runs one registered backend's conformance script. Returns its exit code. */
export function runBackend(root: string, name: string): number {
  const backend = discover(root).registered.find((b) => b.name === name);
  if (backend === undefined) {
    console.error(`conformance: ${name} is not a registered backend`);
    return 1;
  }
  const result = spawnSync("pnpm", ["run", SCRIPT], { cwd: backend.dir, stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`conformance: could not run ${name}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** GitHub Actions job results, as `needs.<job>.result` reports them. */
export type JobResult = "success" | "failure" | "cancelled" | "skipped";

/**
 * The overall conformance verdict, for the one required check: discovery must
 * succeed; with zero registered backends there is nothing to run and it
 * passes; otherwise every matrix run must have succeeded.
 */
export function verdict(discovery: JobResult, count: number, matrix: JobResult): boolean {
  if (discovery !== "success") return false;
  if (count === 0) return true;
  return matrix === "success";
}
