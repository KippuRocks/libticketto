// Opaque credential material — features/002-sdk/plan.md §5.7.
//
// What a credential produces crosses the surface as bytes the SDK never
// interprets. Only the profile in force reads them (REQ-SDK-4, REQ-CP-2), and a
// backend never does (REQ-CP-3).

import type { Brand } from "./identifiers.js";

/** A signer's authorisation over a payload. Opaque. */
export type Authorisation = Brand<Uint8Array, "Authorisation">;

/** What registers a credential to an account (`REQ-CP-6`). Opaque. */
export type Registration = Brand<Uint8Array, "Registration">;

/** A sponsor's undertaking to relay a command and bear its cost (`REQ-SP-1`). Opaque. */
export type Sponsorship = Brand<Uint8Array, "Sponsorship">;

/** Identifies one credential among those registered to an account (`REQ-CP-6`). */
export type CredentialId = Brand<string, "CredentialId">;
