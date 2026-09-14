// @ticketto/profile-v0/testing — software credentials for tests and the
// conformance suite only (features/003-profile-v0/plan.md §5.6). Never import
// this entry point from production code: its keys are plain bytes in memory.

export {
  type SimulatedWebAuthnCredential,
  type SimulatedWebAuthnOptions,
  type SoftwareCredential,
  type SoftwareP256Credential,
  type SoftwareP256Options,
  simulatedWebAuthnSigner,
  softwareP256Signer,
} from "./signers.js";
export {
  type CeremonyOverrides,
  type SimulatedAuthenticatorOptions,
  SimulatedWebAuthnAuthenticator,
} from "./webauthn-authenticator.js";
