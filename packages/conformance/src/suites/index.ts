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
import errIdentifierMismatch from "./ERR-IdentifierMismatch.js";
import errInvalidAuthorisation from "./ERR-InvalidAuthorisation.js";
import errInvalidTransition from "./ERR-InvalidTransition.js";
import errNotOwner from "./ERR-NotOwner.js";
import errRestrictionNotPermitted from "./ERR-RestrictionNotPermitted.js";
import errTicketIdExists from "./ERR-TicketIdExists.js";
import errTicketNotFound from "./ERR-TicketNotFound.js";
import errUnknownZone from "./ERR-UnknownZone.js";
import errZoneExists from "./ERR-ZoneExists.js";
import errZoneInUse from "./ERR-ZoneInUse.js";
import errZoneKindMismatch from "./ERR-ZoneKindMismatch.js";
import inv1 from "./INV-1.js";
import inv2 from "./INV-2.js";
import inv4 from "./INV-4.js";
import inv10 from "./INV-10.js";
import inv11 from "./INV-11.js";
import inv12 from "./INV-12.js";
import inv13 from "./INV-13.js";
import inv14 from "./INV-14.js";
import inv16 from "./INV-16.js";
import reqCp6 from "./REQ-CP-6.js";
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
  // Identity and issuance (T-004-04): US-B1–US-B3, US-B5.
  inv1,
  inv2,
  inv10,
  inv12,
  inv13,
  inv14,
  errTicketIdExists,
  errRestrictionNotPermitted,
  errUnknownZone,
  errZoneKindMismatch,
  errZoneInUse,
  errZoneExists,
  errTicketNotFound,
  errInvalidAuthorisation,
  errIdentifierMismatch,
  reqCp6,
];
