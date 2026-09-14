// The entry point a backend's conformance run calls — REQ-SDK-7, NFR-8.

import type { ConformanceTarget } from "./harness.js";
import { runSuites } from "./suite.js";
import { V0_SUITES } from "./suites/index.js";

/**
 * Registers the whole V0 suite against one backend under one profile. Call it
 * from a Vitest test file in the backend's package; its `conformance` script
 * runs that file (tools/conformance-matrix).
 */
export function defineConformance(target: ConformanceTarget): void {
  runSuites(target, V0_SUITES);
}
