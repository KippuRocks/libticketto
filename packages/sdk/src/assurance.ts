// The assurance declaration — features/002-sdk/plan.md §5.9, REQ-SDK-6.
//
// A backend declares, per invariant of SPEC.md §9, whether it enforces it or
// merely attests it (§4.4). The keys are the generated invariant ids, so a new
// invariant in the spec leaves every declaration incomplete until it is
// declared, and fails to compile.

import type { InvariantId } from "./generated/spec.js";

/** How a backend stands behind one invariant (§4.4). */
export type Assurance = "enforced" | "attested";

/** Every invariant of §9, with the assurance a backend gives it. */
export type AssuranceDeclaration = { readonly [Invariant in InvariantId]: Assurance };
