// The entry point a backend's conformance run calls — REQ-SDK-7, NFR-8,
// features/004-conformance/plan.md §5.2a.

import type { ConformanceTarget } from "./harness.js";
import { type RunOptions, runSuites } from "./suite.js";
import { V0_SUITES } from "./suites/index.js";

/**
 * Registers the V0 suite against one backend under one profile, running every
 * test tagged up to `through` — the current milestone; from `M5`, everything.
 * Call it from a Vitest test file in the backend's package; its `conformance`
 * script runs that file (tools/conformance-matrix).
 */
export function defineConformance(target: ConformanceTarget, options: RunOptions): void {
  runSuites(target, V0_SUITES, options);
}
