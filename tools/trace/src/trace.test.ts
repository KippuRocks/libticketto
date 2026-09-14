import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCOPE_V0, type Scope } from "@ticketto/conformance";
import { describe, expect, it } from "vitest";
import { readTitles, type TestTitle } from "./results.js";
import { expandRange, leadingId, parseSpecIds } from "./spec.js";
import { trace } from "./trace.js";

// T-004-12 — features/004-conformance/plan.md §5.5. The check runs on a fixture
// spec and fixture results; the command line runs on the vendored spec.

const here = import.meta.dirname;
const fixture = (name: string) => join(here, "..", "fixtures", name);
const titlesOf = (...names: string[]): TestTitle[] =>
  names.flatMap((name) => readTitles(readFileSync(fixture(name), "utf8"), name));

const spec = parseSpecIds(readFileSync(fixture("SPEC.md"), "utf8"));
const scope = {
  invariants: ["INV-1"],
  errors: ["ERR-CapacityExceeded"],
  outOfScope: { "INV-2": "fixture: out of scope", "ERR-CannotPay": "fixture: beyond V0" },
} as unknown as Scope;

describe("reading the spec", () => {
  it("tells live identifiers from tombstoned ones, including ranges withdrawn with a story", () => {
    for (const id of [
      "US-A1",
      "AC-A1.1",
      "AC-E5.1",
      "REQ-SDK-7",
      "INV-1",
      "ERR-CannotPay",
      "NFR-8",
    ]) {
      expect(spec.live.has(id), id).toBe(true);
    }
    expect([...spec.tombstoned].sort()).toEqual(
      [
        "AC-E4.1",
        "AC-E4.2",
        "AC-E4.3",
        "AC-E5.2",
        "ERR-BalanceLow",
        "INV-9",
        "REQ-SDK-8",
        "US-E4",
      ].sort(),
    );
  });

  it("reads V0's stories from the release-scope table, expanding ranges, live stories only", () => {
    expect([...spec.v0Stories].sort()).toEqual(["US-A1", "US-E5"]);
  });

  it("reads the vendored spec's V0 stories and tombstones, and agrees with SCOPE_V0", () => {
    const vendored = parseSpecIds(readFileSync(join(here, "../../../spec/SPEC.md"), "utf8"));
    expect([...vendored.v0Stories].sort()).toEqual(
      [
        "US-A1",
        "US-A2",
        "US-A3",
        "US-A4",
        "US-A5",
        "US-A6",
        "US-B1",
        "US-B2",
        "US-B3",
        "US-B4",
        "US-B5",
      ]
        .concat(["US-D1", "US-E1", "US-E2", "US-E3", "US-E5"])
        .sort(),
    );
    for (const id of [
      "INV-9",
      "US-E4",
      "AC-E4.1",
      "AC-E4.4",
      "AC-E5.4",
      "ERR-BalanceLow",
      "REQ-CP-4",
    ]) {
      expect(vendored.tombstoned.has(id), id).toBe(true);
    }
    const report = trace({ spec: vendored, scope: SCOPE_V0, titles: [] });
    expect(report.problems.filter((p) => p.startsWith("scope:"))).toEqual([]);
  });

  it("expands ranges and reads a title's leading identifier", () => {
    expect(expandRange("US-A1", "US-A3")).toEqual(["US-A1", "US-A2", "US-A3"]);
    expect(expandRange("AC-E4.1", "AC-E4.3")).toEqual(["AC-E4.1", "AC-E4.2", "AC-E4.3"]);
    expect(leadingId("INV-13: a second ticket")).toBe("INV-13");
    expect(leadingId("AC-E3.2 — exactly one")).toBe("AC-E3.2");
    expect(leadingId("REQ-CP-6: a second device")).toBe("REQ-CP-6");
    expect(leadingId("ERR-PassExpired: outside")).toBe("ERR-PassExpired");
    expect(leadingId("harness: no identifier")).toBeUndefined();
    expect(leadingId("names INV-4 later")).toBeUndefined();
  });
});

describe("reading results", () => {
  it("reads Vitest JSON and JUnit XML, with block names, and skips tests that did not run", () => {
    expect(titlesOf("libticketto.json").map((t) => t.path)).toEqual([
      ["backend-memory × profile-v0", "INV-1: a ticket belongs to exactly one event"],
      ["backend-memory × profile-v0", "ERR-CapacityExceeded: issuance beyond capacity fails"],
      ["REQ-SDK-7 the suite runs against every backend", "runs"],
    ]);
    expect(titlesOf("kippu-api.xml").map((t) => t.path)).toEqual([
      ["events", "AC-A1.1: an organiser creates an event & owns it"],
      ["AC-E5.1: authorisation is granted in Kippu"],
    ]);
  });
});

describe("trace", () => {
  it("passes when results from several repositories cover every required identifier", () => {
    const report = trace({
      spec,
      scope,
      titles: titlesOf("libticketto.json", "kippu-api.xml", "covers-a1-2.json"),
    });
    expect(report.problems).toEqual([]);
    expect(report.required).toEqual([
      "AC-A1.1",
      "AC-A1.2",
      "AC-E5.1",
      "ERR-CapacityExceeded",
      "INV-1",
    ]);
    expect(report.covered).toEqual(report.required);
  });

  it("fails on an uncovered V0 identifier", () => {
    const report = trace({ spec, scope, titles: titlesOf("libticketto.json", "kippu-api.xml") });
    expect(report.problems).toEqual(["AC-A1.2 has no test"]);
  });

  it("fails on a test naming an identifier the spec does not define", () => {
    const report = trace({
      spec,
      scope,
      titles: titlesOf("libticketto.json", "kippu-api.xml", "covers-a1-2.json", "unknown.json"),
    });
    expect(report.problems).toEqual([
      'INV-99 is not defined in the spec, but a test names it: "INV-99: an invariant the spec never defined" (unknown.json)',
    ]);
  });

  it("fails on a test naming a tombstoned identifier", () => {
    const report = trace({
      spec,
      scope,
      titles: titlesOf("libticketto.json", "kippu-api.xml", "covers-a1-2.json", "tombstoned.xml"),
    });
    expect(report.problems).toEqual([
      'AC-E4.2 is tombstoned, but a test names it: "AC-E4.2: an offline gate admits" (tombstoned.xml)',
      'ERR-BalanceLow is tombstoned, but a test names it: "gate > ERR-BalanceLow: the old name of CannotPay" (tombstoned.xml)',
    ]);
  });

  it("waives allow-listed identifiers, and fails an allow-list naming a tombstone", () => {
    const titles = titlesOf("libticketto.json", "covers-a1-2.json");
    expect(trace({ spec, scope, titles }).problems).toEqual([
      "AC-A1.1 has no test",
      "AC-E5.1 has no test",
    ]);
    expect(trace({ spec, scope, titles, allow: ["AC-A1.1", "AC-E5.1"] }).problems).toEqual([]);
    expect(
      trace({ spec, scope, titles, allow: ["AC-A1.1", "AC-E5.1", "AC-E5.2"] }).problems,
    ).toEqual(["allow-list: AC-E5.2 is tombstoned in the spec"]);
  });

  it("fails when the scope does not classify the spec's invariants and errors", () => {
    const narrow = { ...scope, outOfScope: { "INV-2": "fixture" } } as unknown as Scope;
    expect(trace({ spec, scope: narrow, titles: titlesOf("libticketto.json") }).problems).toContain(
      "scope: ERR-CannotPay is neither in scope nor out of scope",
    );
  });
});

describe("the command line", () => {
  const cli = join(here, "..", "dist", "cli.js");
  const vendored = join(here, "../../../spec/SPEC.md");
  const run = (args: string[]) => {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { status: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  };

  /** A JSON result file naming every V0 identifier, plus `extra` titles. */
  const results = (extra: string[], omit?: string) => {
    const report = trace({
      spec: parseSpecIds(readFileSync(vendored, "utf8")),
      scope: SCOPE_V0,
      titles: [],
    });
    const titles = [
      ...report.required.filter((id) => id !== omit).map((id) => `${id}: covered`),
      ...extra,
    ];
    const dir = mkdtempSync(join(tmpdir(), "ticketto-trace-"));
    const path = join(dir, "results.json");
    writeFileSync(
      path,
      JSON.stringify({
        testResults: [
          {
            assertionResults: titles.map((title) => ({
              ancestorTitles: [],
              title,
              status: "passed",
            })),
          },
        ],
      }),
    );
    return path;
  };

  it("exits 0 when everything is covered", () => {
    const outcome = run(["--spec", vendored, "--scope", "v0", "--results", results([])]);
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
  });

  it("exits 1 on an uncovered V0 id, an unknown id, and a tombstoned id", () => {
    const uncovered = run([
      "--spec",
      vendored,
      "--scope",
      "v0",
      "--results",
      results([], "INV-13"),
    ]);
    expect(uncovered.status).toBe(1);
    expect(uncovered.stderr).toContain("INV-13 has no test");

    const unknown = run([
      "--spec",
      vendored,
      "--scope",
      "v0",
      "--results",
      results(["INV-99: nope"]),
    ]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("INV-99 is not defined in the spec");

    const tombstoned = run([
      "--spec",
      vendored,
      "--scope",
      "v0",
      "--results",
      results(["INV-9: custody"]),
    ]);
    expect(tombstoned.status).toBe(1);
    expect(tombstoned.stderr).toContain("INV-9 is tombstoned");
  });

  it("reads several result files and an allow-list, and exits 2 on a usage error", () => {
    const allow = join(mkdtempSync(join(tmpdir(), "ticketto-trace-")), "allow.txt");
    writeFileSync(allow, "# not yet\nINV-13\n");
    const outcome = run([
      "--spec",
      vendored,
      "--scope",
      "v0",
      "--results",
      results([], "INV-13"),
      fixture("covers-a1-2.json"),
      "--allow",
      allow,
    ]);
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(
      run(["--spec", vendored, "--scope", "v1", "--results", fixture("unknown.json")]).status,
    ).toBe(2);
    expect(run(["--scope", "v0"]).status).toBe(2);
  });
});
