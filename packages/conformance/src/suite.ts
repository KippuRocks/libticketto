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

/**
 * Registers one test: titled `<id>: …`, tagged with the milestone whose rules
 * it needs, and run in a fresh world.
 */
export type SuiteTest = (
  title: string,
  milestone: Milestone,
  body: (world: World) => Promise<void>,
) => void;

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

/** Registers `suites` against `target`, under one `describe` named for the target. */
export function runSuites(
  target: ConformanceTarget,
  suites: readonly Suite[],
  { through }: RunOptions,
): void {
  const last = milestoneIndex(through);
  if (last === -1) throw new Error(`conformance: unknown milestone ${String(through)}`);
  describe(`${target.name} (through ${through})`, () => {
    for (const { id, define } of suites) {
      define((title, milestone, body) => {
        const error = titleError(id, title) ?? milestoneError(title, milestone);
        if (error !== undefined) throw new Error(error);
        const run = async () => {
          await body(await createWorld(target));
        };
        if (milestoneIndex(milestone) <= last) it(title, run);
        else it.skip(title, run);
      });
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
