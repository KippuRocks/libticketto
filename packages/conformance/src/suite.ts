// Suites and how they run — features/004-conformance/plan.md §5.2, §5.2a.
//
// One suite per identifier. Every test title begins with the identifier it
// verifies, followed by a colon, so `ticketto-trace` can read coverage from test
// results; a title that does not is refused when the suite is defined.
//
// Every test is tagged with the milestone whose rules it needs. A run goes
// through one milestone: tests tagged up to it run, later ones are registered
// as skipped. A tag schedules a test; it never removes one from V0 scope.

import { describe, it } from "vitest";
import type { ConformanceTarget } from "./harness.js";
import { createWorld, type World } from "./world.js";

/** The milestones rules land in (PLAN.md §5.2). From `M5`, every test runs. */
export const MILESTONES = ["M1", "M2", "M3", "M4", "M5"] as const;

/** A milestone of `PLAN.md` §5.2. */
export type Milestone = (typeof MILESTONES)[number];

/** Options for one test. */
export interface TestOptions {
  /** How long the test may run, in milliseconds. Defaults to the runner's. */
  readonly timeout?: number;
}

/**
 * Registers one test: titled `<id>: …`, tagged with the milestone whose rules
 * it needs, and run in a fresh world.
 */
export type SuiteTest = (
  title: string,
  milestone: Milestone,
  body: (world: World) => Promise<void>,
  options?: TestOptions,
) => void;

/** One test of a suite, as defined, not yet registered with a runner. */
export interface ConformanceTest {
  readonly suite: string;
  readonly title: string;
  readonly milestone: Milestone;
  readonly body: (world: World) => Promise<void>;
  readonly options: TestOptions;
}

/** The tests for one identifier — an `INV-*`, an `ERR-*`, or a requirement they serve. */
export interface Suite {
  readonly id: string;
  define(test: SuiteTest): void;
}

/** How far a run goes. */
export interface RunOptions {
  /** Runs every test tagged with this milestone or an earlier one. */
  readonly through: Milestone;
}

/** Declares a suite. */
export function suite(id: string, define: (test: SuiteTest) => void): Suite {
  return { id, define };
}

/**
 * The tests `suites` define, checked: a title not beginning `<id>: `, or a
 * missing or unknown milestone tag, throws.
 */
export function collectTests(suites: readonly Suite[]): ConformanceTest[] {
  const tests: ConformanceTest[] = [];
  for (const { id, define } of suites) {
    define((title, milestone, body, options = {}) => {
      const error = titleError(id, title) ?? milestoneError(title, milestone);
      if (error !== undefined) throw new Error(error);
      tests.push({ suite: id, title, milestone, body, options });
    });
  }
  return tests;
}

/** Whether a test tagged `milestone` runs in a run through `through`. */
export function runsThrough(milestone: Milestone, through: Milestone): boolean {
  const last = milestoneIndex(through);
  if (last === -1) throw new Error(`conformance: unknown milestone ${String(through)}`);
  return milestoneIndex(milestone) <= last;
}

/** Runs one test's body in a fresh world for `target`. */
export async function runTest(target: ConformanceTarget, test: ConformanceTest): Promise<void> {
  await test.body(await createWorld(target));
}

/** Registers `suites` against `target`, under one `describe` named for the target. */
export function runSuites(
  target: ConformanceTarget,
  suites: readonly Suite[],
  { through }: RunOptions,
): void {
  runsThrough("M1", through);
  const tests = collectTests(suites);
  describe(`${target.name} (through ${through})`, () => {
    for (const test of tests) {
      const run = () => runTest(target, test);
      if (runsThrough(test.milestone, through)) it(test.title, run, test.options.timeout);
      else it.skip(test.title, run);
    }
  });
}

function milestoneIndex(milestone: unknown): number {
  return MILESTONES.indexOf(milestone as Milestone);
}

/** Why `title` is not a valid title for a test in suite `id`, or `undefined` if it is. */
export function titleError(id: string, title: string): string | undefined {
  if (title.startsWith(`${id}: `)) return undefined;
  return `conformance: a test in suite ${id} must be titled "${id}: …": ${title}`;
}

/** Why `milestone` is not a valid tag, or `undefined` if it is. An untagged test is an error. */
export function milestoneError(title: string, milestone: unknown): string | undefined {
  if (milestoneIndex(milestone) !== -1) return undefined;
  return `conformance: "${title}" must be tagged with one of ${MILESTONES.join(", ")}, not ${String(milestone)}`;
}
