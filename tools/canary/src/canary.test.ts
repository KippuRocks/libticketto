import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clientManifest,
  publicPackages,
  run,
  snapshotChangeset,
  snapshotConfig,
} from "./canary.js";

const root = join(import.meta.dirname, "..", "..", "..");

describe("canary", () => {
  it("releases every @ticketto/* package in the workspace", () => {
    const names = publicPackages(root).map((p) => p.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^@ticketto\//);
  });

  it("writes a changeset that bumps each package", () => {
    expect(snapshotChangeset(["@ticketto/sdk", "@ticketto/rx"])).toBe(
      '---\n"@ticketto/sdk": patch\n"@ticketto/rx": patch\n---\n\nCanary snapshot.\n',
    );
  });

  it("points the client and every internal dependency at the tarballs, not a registry", () => {
    const manifest = clientManifest([
      { name: "@ticketto/sdk", version: "0.0.0-canary", path: "/t/sdk.tgz" },
    ]);
    expect(manifest.dependencies).toEqual({ "@ticketto/sdk": "file:/t/sdk.tgz" });
    expect(manifest.pnpm).toEqual({ overrides: { "@ticketto/sdk": "file:/t/sdk.tgz" } });
  });

  it("versions the snapshot without a changelog, so Changesets never fetches history", () => {
    expect(snapshotConfig({ baseBranch: "main", changelog: "@changesets/cli/changelog" })).toEqual({
      baseBranch: "main",
      changelog: false,
    });
  });
});

describe("canary steps", () => {
  const node = process.execPath;

  it("closes stdin, so a command waiting for input ends instead of hanging", async () => {
    const { stdout } = await run(
      node,
      ["-e", "process.stdin.on('data', () => {}).on('end', () => console.log('eof'))"],
      root,
      10_000,
    );
    expect(stdout.trim()).toBe("eof");
  });

  it("kills a step that outlives its bound, with its descendants, and names the step", async () => {
    const started = Date.now();
    const grandchild = `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)`;
    await expect(run(node, ["-e", grandchild], root, 500)).rejects.toThrow(/timed out after 0\.5s/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports a failing step with its output", async () => {
    await expect(
      run(node, ["-e", "console.error('boom'); process.exit(3)"], root, 10_000),
    ).rejects.toThrow(/failed \(exit 3\)[\s\S]*boom/);
  });
});
