// The assurance declaration — T-005-04, features/005-backend-memory/plan.md §5.3,
// REQ-SDK-6.
//
// The in-memory backend stands in for the hosted backend, so it declares §4.4's
// hosted column and never more. A single in-process authority enforces `INV-6`
// (double-use prevention) and `INV-7` (atomicity, one transaction boundary).
// Every other invariant is attested: §4.4 marks `INV-3` attested for the hosted
// backend, and what §4.4 does not claim as enforced, this backend does not claim
// either.

import type { AssuranceDeclaration } from "@ticketto/sdk";

/** The in-memory backend's declaration: §4.4's hosted column. */
export const MEMORY_ASSURANCE: AssuranceDeclaration = Object.freeze({
  "INV-1": "attested",
  "INV-2": "attested",
  "INV-3": "attested",
  "INV-4": "attested",
  "INV-5": "attested",
  "INV-6": "enforced",
  "INV-7": "enforced",
  "INV-8": "attested",
  "INV-10": "attested",
  "INV-11": "attested",
  "INV-12": "attested",
  "INV-13": "attested",
  "INV-14": "attested",
  "INV-15": "attested",
  "INV-16": "attested",
});
