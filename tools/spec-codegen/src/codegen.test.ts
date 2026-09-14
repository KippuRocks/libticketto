import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { check, generate, paths, sha256 } from "./codegen.js";
import { parseSpec, SpecParseError } from "./parse.js";

const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway checkout holding a copy of the vendored spec, its pin, and the generated file. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-codegen-"));
  roots.push(root);
  const from = paths(workspaceRoot);
  const to = paths(root);
  mkdirSync(join(root, "spec"), { recursive: true });
  mkdirSync(join(root, "packages", "sdk", "src", "generated"), { recursive: true });
  cpSync(from.spec, to.spec);
  cpSync(from.source, to.source);
  cpSync(from.generated, to.generated);
  return root;
}

function editSpec(root: string, edit: (spec: string) => string, repin: boolean): void {
  const p = paths(root);
  const spec = edit(readFileSync(p.spec, "utf8"));
  writeFileSync(p.spec, spec);
  if (repin) {
    const source = JSON.parse(readFileSync(p.source, "utf8"));
    writeFileSync(p.source, JSON.stringify({ ...source, sha256: sha256(spec) }));
  }
}

const minimal = (errors: string, note: string, invariants = "| `INV-1` | One. |") => `
## 9. Invariants

| ID | Invariant |
|---|---|
${invariants}

---

## 10. Errors

| ID | Condition |
|---|---|
${errors}

${note}

---

## 11. Next
`;

const note =
  "**Errors by where they arise.** Every error above is raised by the ledger's rules, except two " +
  "groups. `ERR-B` is a **platform error**, so Kippu raises it.\n`ERR-C` is raised by a backend " +
  "binding. Neither group can be produced by a ledger.";

describe("parseSpec", () => {
  it("excludes renamed and withdrawn rows", () => {
    const surface = parseSpec(
      minimal(
        [
          "| `ERR-A` | A condition |",
          "| `ERR-Old` | *Renamed `ERR-A` by amendment 0002.* |",
          "| `ERR-B` | B |",
          "| `ERR-C` | C |",
        ].join("\n"),
        note,
        "| `INV-1` | One. |\n| `INV-2` | *Withdrawn by amendment 0002.* |",
      ),
    );
    expect(surface.errors.map((e) => e.id)).toEqual(["ERR-A", "ERR-B", "ERR-C"]);
    expect(surface.invariants.map((i) => i.id)).toEqual(["INV-1"]);
  });

  it("tags errors ledger, platform or binding from §10's note", () => {
    const surface = parseSpec(minimal("| `ERR-A` | A |\n| `ERR-B` | B |\n| `ERR-C` | C |", note));
    expect(Object.fromEntries(surface.errors.map((e) => [e.id, e.origin]))).toEqual({
      "ERR-A": "ledger",
      "ERR-B": "platform",
      "ERR-C": "binding",
    });
  });

  it("refuses a spec whose §10 has lost its note on where errors arise", () => {
    expect(() => parseSpec(minimal("| `ERR-A` | A |", ""))).toThrow(SpecParseError);
  });

  it("refuses a note naming an error with no live row", () => {
    expect(() => parseSpec(minimal("| `ERR-A` | A |\n| `ERR-B` | B |", note))).toThrow(
      /ERR-C, which has no live row/,
    );
  });

  it("reads the vendored spec: platform and binding errors per amendment 0003", () => {
    const surface = parseSpec(readFileSync(paths(workspaceRoot).spec, "utf8"));
    const tagged = surface.errors.filter((e) => e.origin !== "ledger");
    expect(tagged.map((e) => [e.id, e.origin])).toEqual([
      ["ERR-ClassQuotaExceeded", "platform"],
      ["ERR-UnknownClass", "platform"],
      ["ERR-LedgerUnavailable", "binding"],
    ]);
    expect(surface.errors.map((e) => e.id)).not.toContain("ERR-BalanceLow");
    expect(surface.invariants.map((i) => i.id)).not.toContain("INV-9");
  });
});

describe("check", () => {
  it("passes on the checked-in workspace", () => {
    expect(check(workspaceRoot)).toEqual({ ok: true, messages: [] });
  });

  it("fails when a §10 row changes, until regenerated", () => {
    const root = checkout();
    editSpec(
      root,
      (spec) =>
        spec.replace(
          "| `ERR-CannotPay` | Buyer cannot pay the asking price |",
          "| `ERR-CannotPayNow` | Buyer cannot pay |",
        ),
      true,
    );
    const drifted = check(root);
    expect(drifted.ok).toBe(false);
    expect(drifted.messages.join("\n")).toMatch(/out of date/);

    expect(generate(root).ok).toBe(true);
    expect(check(root)).toEqual({ ok: true, messages: [] });
    expect(readFileSync(paths(root).generated, "utf8")).toContain('"ERR-CannotPayNow"');
  });

  it("fails when the vendored spec is edited without re-pinning it", () => {
    const root = checkout();
    editSpec(root, (spec) => `${spec}\n`, false);
    const outcome = check(root);
    expect(outcome.ok).toBe(false);
    expect(outcome.messages.join("\n")).toMatch(/does not match the sha256/);
    expect(generate(root).ok).toBe(false);
  });
});
