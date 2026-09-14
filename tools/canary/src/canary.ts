import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface PublicPackage {
  readonly name: string;
  readonly dir: string;
}

export interface Tarball {
  readonly name: string;
  readonly version: string;
  readonly path: string;
}

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
}

/** Every `packages/*` member that is not private: what a release publishes. */
export function publicPackages(root: string): PublicPackage[] {
  const dir = join(root, "packages");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const manifest = readJson<Manifest>(join(dir, entry.name, "package.json"));
        return manifest.private === true
          ? []
          : [{ name: manifest.name, dir: join(dir, entry.name) }];
      } catch {
        return [];
      }
    });
}

/** A changeset bumping every named package, so a snapshot covers all of them. */
export function snapshotChangeset(names: readonly string[]): string {
  return [
    "---",
    ...names.map((name) => `"${name}": patch`),
    "---",
    "",
    "Canary snapshot.",
    "",
  ].join("\n");
}

/**
 * The manifest of a client that depends on every tarball. `pnpm.overrides`
 * pins internal dependencies between the packages to the same tarballs, so
 * nothing is fetched from a registry.
 */
export function clientManifest(tarballs: readonly Tarball[]): Record<string, unknown> {
  const specs = Object.fromEntries(tarballs.map((t) => [t.name, `file:${t.path}`]));
  return {
    name: "ticketto-canary-client",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: specs,
    pnpm: { overrides: specs },
  };
}

/**
 * Builds a Changesets snapshot release of every public package at `HEAD` and
 * packs each into `outDir`. Works in a temporary git worktree, so the caller's
 * checkout is never modified. Nothing is published.
 */
export async function packCanary(root: string, outDir: string, tag = "canary"): Promise<Tarball[]> {
  const worktree = mkdtempSync(join(tmpdir(), "ticketto-canary-"));
  mkdirSync(outDir, { recursive: true });
  await run("git", ["worktree", "add", "--detach", worktree, "HEAD"], root);
  try {
    await run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], worktree);
    await run("pnpm", ["--recursive", "--filter", "./packages/*", "build"], worktree);
    const names = publicPackages(worktree).map((p) => p.name);
    writeFileSync(join(worktree, ".changeset", `${tag}.md`), snapshotChangeset(names));
    await run("pnpm", ["exec", "changeset", "version", "--snapshot", tag], worktree);
    const before = new Set(readdirSync(outDir));
    await run(
      "pnpm",
      ["--recursive", "--filter", "./packages/*", "pack", "--pack-destination", outDir],
      worktree,
    );
    const versions = new Map(
      publicPackages(worktree).map((p) => [
        p.name,
        readJson<Manifest>(join(p.dir, "package.json")),
      ]),
    );
    const created = readdirSync(outDir).filter((f) => f.endsWith(".tgz") && !before.has(f));
    return [...versions.values()].map(({ name, version }) => {
      const file = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
      if (!created.includes(file)) throw new Error(`pnpm pack did not produce ${file}`);
      return { name, version, path: join(outDir, file) };
    });
  } finally {
    await run("git", ["worktree", "remove", "--force", worktree], root);
  }
}

/**
 * Installs the tarballs into a fresh client outside the workspace, then imports
 * every package by name under Node and typechecks the same imports with
 * TypeScript. Returns the client directory.
 */
export async function installInClient(tarballs: readonly Tarball[], tsc: string): Promise<string> {
  const client = mkdtempSync(join(tmpdir(), "ticketto-client-"));
  // Short local copies: pnpm's store indexes `file:` specs by path, and
  // snapshot versions make the packed file names long.
  mkdirSync(join(client, "tarballs"));
  const local = tarballs.map((t, i) => {
    const path = `./tarballs/${i}.tgz`;
    copyFileSync(t.path, join(client, path));
    return { ...t, path };
  });
  writeFileSync(
    join(client, "package.json"),
    `${JSON.stringify(clientManifest(local), null, 2)}\n`,
  );
  const imports = tarballs.map((t, i) => `import * as m${i} from ${JSON.stringify(t.name)};`);
  const modules = `[${tarballs.map((_, i) => `m${i}`).join(", ")}]`;
  writeFileSync(
    join(client, "index.ts"),
    [...imports, `export const modules: readonly object[] = ${modules};`, ""].join("\n"),
  );
  writeFileSync(
    join(client, "index.js"),
    [...imports, `console.log(${modules}.length);`, ""].join("\n"),
  );
  writeFileSync(
    join(client, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      files: ["index.ts"],
    }),
  );

  await run("pnpm", ["install", "--ignore-workspace"], client);
  for (const tarball of tarballs) {
    const installed = readJson<Manifest>(
      join(client, "node_modules", tarball.name, "package.json"),
    );
    if (installed.version !== tarball.version) {
      throw new Error(`${tarball.name}: installed ${installed.version}, packed ${tarball.version}`);
    }
  }
  const { stdout } = await run(process.execPath, ["index.js"], client);
  if (stdout.trim() !== String(tarballs.length)) {
    throw new Error(`expected ${tarballs.length} modules to import, got: ${stdout}`);
  }
  await run(tsc, ["-p", "tsconfig.json"], client);
  return client;
}

async function run(command: string, args: readonly string[], cwd: string) {
  try {
    return await exec(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(
      `${basename(command)} ${args.join(" ")} failed in ${cwd}\n${stdout ?? ""}${stderr ?? ""}`,
    );
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
