import { spawn } from "node:child_process";
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

/**
 * Per-step bounds. Each step normally takes seconds; a step that reaches its
 * bound is killed with its whole process tree and fails the canary naming the
 * step, instead of idling until CI cancels the job.
 */
export const STEP_TIMEOUT_MS = {
  git: 60_000,
  install: 300_000,
  build: 300_000,
  version: 120_000,
  pack: 180_000,
  import: 60_000,
  typecheck: 180_000,
} as const;

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

/**
 * The Changesets config for the snapshot: the repository's own, with changelog
 * generation off. A snapshot's changelog is thrown away, and generating one
 * makes Changesets look up the commit that added each pending changeset; in a
 * shallow clone (CI's checkout) that lookup runs `git fetch --deepen` against
 * the remote, which is what intermittently hung the canary job.
 */
export function snapshotConfig(config: Record<string, unknown>): Record<string, unknown> {
  return { ...config, changelog: false };
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
  await run("git", ["worktree", "add", "--detach", worktree, "HEAD"], root, STEP_TIMEOUT_MS.git);
  try {
    await run(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline"],
      worktree,
      STEP_TIMEOUT_MS.install,
    );
    await run(
      "pnpm",
      ["--recursive", "--filter", "./packages/*", "build"],
      worktree,
      STEP_TIMEOUT_MS.build,
    );
    const names = publicPackages(worktree).map((p) => p.name);
    const configPath = join(worktree, ".changeset", "config.json");
    writeFileSync(configPath, `${JSON.stringify(snapshotConfig(readJson(configPath)), null, 2)}\n`);
    writeFileSync(join(worktree, ".changeset", `${tag}.md`), snapshotChangeset(names));
    // Versioning is local. Forbidding every git transport but `file` makes any
    // future network fetch from Changesets fail at once rather than hang.
    await run(
      "pnpm",
      ["exec", "changeset", "version", "--snapshot", tag],
      worktree,
      STEP_TIMEOUT_MS.version,
      { GIT_ALLOW_PROTOCOL: "file" },
    );
    const before = new Set(readdirSync(outDir));
    await run(
      "pnpm",
      ["--recursive", "--filter", "./packages/*", "pack", "--pack-destination", outDir],
      worktree,
      STEP_TIMEOUT_MS.pack,
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
    await run("git", ["worktree", "remove", "--force", worktree], root, STEP_TIMEOUT_MS.git);
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

  // No lockfile exists for the client; say so rather than inherit CI's default.
  await run(
    "pnpm",
    ["install", "--ignore-workspace", "--no-frozen-lockfile"],
    client,
    STEP_TIMEOUT_MS.install,
  );
  for (const tarball of tarballs) {
    const installed = readJson<Manifest>(
      join(client, "node_modules", tarball.name, "package.json"),
    );
    if (installed.version !== tarball.version) {
      throw new Error(`${tarball.name}: installed ${installed.version}, packed ${tarball.version}`);
    }
  }
  const { stdout } = await run(process.execPath, ["index.js"], client, STEP_TIMEOUT_MS.import);
  if (stdout.trim() !== String(tarballs.length)) {
    throw new Error(`expected ${tarballs.length} modules to import, got: ${stdout}`);
  }
  await run(tsc, ["-p", "tsconfig.json"], client, STEP_TIMEOUT_MS.typecheck);
  return client;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one step non-interactively and bounded. Stdin is closed, so a command
 * that asks a question fails instead of waiting for an answer; `CI` is set and
 * git terminal prompts are off. The child gets its own process group so that,
 * on timeout, its whole tree (e.g. `git` → `git-remote-https`) is killed.
 * Each step is logged as it starts and ends, so a failing log names the step.
 */
export function run(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  env: Readonly<Record<string, string>> = {},
): Promise<RunResult> {
  const step = `${basename(command)} ${args.join(" ")}`;
  const started = Date.now();
  const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
  console.log(`canary: > ${step}  (in ${cwd}, timeout ${timeoutMs / 1000}s)`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    let settled = false;
    let killed = false;
    let grace: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      clearTimeout(grace);
      if (error) {
        reject(error);
      } else {
        console.log(`canary:   done in ${seconds()}s`);
        resolve({ stdout, stderr });
      }
    };
    const timedOut = () =>
      new Error(
        `canary: ${step} timed out after ${timeoutMs / 1000}s in ${cwd}; killed. Output so far:\n${stdout}${stderr}`,
      );

    const bound = setTimeout(() => {
      killed = true;
      killTree(child.pid);
      // A descendant that left the process group can hold the pipes open, so
      // `close` may never come: fail regardless after a short grace period.
      grace = setTimeout(() => settle(timedOut()), 5_000);
    }, timeoutMs);
    child.on("error", (error) => {
      settle(new Error(`canary: ${step} could not start in ${cwd}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (killed) settle(timedOut());
      else if (code === 0) settle();
      else {
        settle(
          new Error(
            `canary: ${step} failed (${signal ?? `exit ${code}`}) after ${seconds()}s in ${cwd}\n${stdout}${stderr}`,
          ),
        );
      }
    });
  });
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
