import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientManifest, publicPackages, snapshotChangeset } from "./canary.js";

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
});
