// The V0 conformance suite: one suite per identifier in `scope.v0.ts`'s V0 list,
// plus the requirements the suite checks of every backend
// (features/004-conformance/plan.md §5.2).

import type { Suite } from "../suite.js";
import requirementSdk6 from "./REQ-SDK-6.js";

/** Every suite `defineConformance` runs, in order. */
export const V0_SUITES: readonly Suite[] = [requirementSdk6];
