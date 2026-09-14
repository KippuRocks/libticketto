import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSpec } from "./parse.js";
import { render, type SpecSource } from "./render.js";

/** Paths inside a libticketto checkout. */
export function paths(root: string) {
  return {
    spec: join(root, "spec", "SPEC.md"),
    source: join(root, "spec", "source.json"),
    generated: join(root, "packages", "sdk", "src", "generated", "spec.ts"),
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface Outcome {
  readonly ok: boolean;
  readonly messages: readonly string[];
}

function readSource(root: string): SpecSource {
  return JSON.parse(readFileSync(paths(root).source, "utf8")) as SpecSource;
}

/**
 * The vendored spec and its pin agree, and the generated file is what the spec
 * generates. Fails on a spec edited without re-vendoring, and on a spec change
 * not yet regenerated.
 */
export function check(root: string): Outcome {
  const p = paths(root);
  const spec = readFileSync(p.spec, "utf8");
  const source = readSource(root);
  const messages: string[] = [];
  if (sha256(spec) !== source.sha256) {
    messages.push(
      "spec/SPEC.md does not match the sha256 pinned in spec/source.json — " +
        "re-vendor it with `pnpm spec:vendor <kippu-docs checkout> <commit>`",
    );
  }
  const expected = render(parseSpec(spec), source);
  let actual: string | undefined;
  try {
    actual = readFileSync(p.generated, "utf8");
  } catch {
    actual = undefined;
  }
  if (actual !== expected) {
    messages.push(
      "packages/sdk/src/generated/spec.ts is out of date with spec/SPEC.md — run `pnpm spec:generate`",
    );
  }
  return { ok: messages.length === 0, messages };
}

/** Writes the generated file from the vendored spec. Refuses a spec that does not match its pin. */
export function generate(root: string): Outcome {
  const p = paths(root);
  const spec = readFileSync(p.spec, "utf8");
  const source = readSource(root);
  if (sha256(spec) !== source.sha256) {
    return {
      ok: false,
      messages: ["spec/SPEC.md does not match its pin in spec/source.json; re-vendor it instead"],
    };
  }
  mkdirSync(dirname(p.generated), { recursive: true });
  writeFileSync(p.generated, render(parseSpec(spec), source));
  return { ok: true, messages: [`wrote ${p.generated}`] };
}

/**
 * Copies SPEC.md at `commit` out of a kippu-docs checkout, pins it in
 * `spec/source.json`, and regenerates.
 */
export function vendor(root: string, docs: string, commit: string, ref: string): Outcome {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", docs, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const full = git("rev-parse", "--verify", `${commit}^{commit}`).trim();
  const spec = git("show", `${full}:SPEC.md`);
  const source: SpecSource = {
    repository: "KippuRocks/kippu-docs",
    path: "SPEC.md",
    commit: full,
    ref,
    sha256: sha256(spec),
  };
  const p = paths(root);
  mkdirSync(dirname(p.spec), { recursive: true });
  writeFileSync(p.spec, spec);
  writeFileSync(p.source, `${JSON.stringify(source, null, 2)}\n`);
  return generate(root);
}
