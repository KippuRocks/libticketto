// The V0 conformance suite: one suite per identifier in `scope.v0.ts`'s V0 list,
// plus the requirements the suite checks of every backend
// (features/004-conformance/plan.md §5.2).

import type { Suite } from "../suite.js";
import errCapacityBelowIssuance from "./ERR-CapacityBelowIssuance.js";
import errCapacityExceeded from "./ERR-CapacityExceeded.js";
import errCapacityProofRequired from "./ERR-CapacityProofRequired.js";
import errEventCancelled from "./ERR-EventCancelled.js";
import errEventFinished from "./ERR-EventFinished.js";
import errEventIdExists from "./ERR-EventIdExists.js";
import errEventNotFound from "./ERR-EventNotFound.js";
import errEventSealed from "./ERR-EventSealed.js";
import errInvalidTransition from "./ERR-InvalidTransition.js";
import errNotOwner from "./ERR-NotOwner.js";
import inv4 from "./INV-4.js";
import inv11 from "./INV-11.js";
import inv16 from "./INV-16.js";
import reqSdk6 from "./REQ-SDK-6.js";

/** Every suite `defineConformance` runs, in order. */
export const V0_SUITES: readonly Suite[] = [
  reqSdk6,
  // Event lifecycle (T-004-03): US-A1, US-A4–US-A6.
  inv4,
  inv11,
  inv16,
  errCapacityExceeded,
  errCapacityBelowIssuance,
  errCapacityProofRequired,
  errEventSealed,
  errEventCancelled,
  errEventFinished,
  errInvalidTransition,
  errNotOwner,
  errEventIdExists,
  errEventNotFound,
];
