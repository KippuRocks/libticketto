// Suites and how they run — features/004-conformance/plan.md §5.2.
//
// One suite per identifier. Every test title begins with the identifier it
// verifies, followed by a colon, so `ticketto-trace` can read coverage from test
// results; a title that does not is refused when the suite is defined.

import { describe, it } from "vitest";
import type { ConformanceTarget } from "./harness.js";
import { createWorld, type World } from "./world.js";

/** Registers one test: its title begins `<id>: `, and it runs in a fresh world. */
export type SuiteTest = (title: string, body: (world: World) => Promise<void>) => void;

/** The tests for one identifier — an `INV-*`, an `ERR-*`, or a requirement they serve. */
export interface Suite {
  readonly id: string;
  define(test: SuiteTest): void;
}

/** Declares a suite. */
export function suite(id: string, define: (test: SuiteTest) => void): Suite {
  return { id, define };
}

/** Registers `suites` against `target`, under one `describe` named for the target. */
export function runSuites(target: ConformanceTarget, suites: readonly Suite[]): void {
  describe(target.name, () => {
    for (const { id, define } of suites) {
      define((title, body) => {
        const error = titleError(id, title);
        if (error !== undefined) throw new Error(error);
        it(title, async () => {
          await body(await createWorld(target));
        });
      });
    }
  });
}

/** Why `title` is not a valid title for a test in suite `id`, or `undefined` if it is. */
export function titleError(id: string, title: string): string | undefined {
  if (title.startsWith(`${id}: `)) return undefined;
  return `conformance: a test in suite ${id} must be titled "${id}: …": ${title}`;
}
