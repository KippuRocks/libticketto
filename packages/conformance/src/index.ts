// @ticketto/conformance — the shared conformance suite (REQ-SDK-7, NFR-8).
// Design: features/004-conformance/plan.md in KippuRocks/kippu-docs.
//
// Test infrastructure only: its V0 fixtures hold software keys in plain bytes.

export { defineConformance } from "./conformance.js";
export { expectError, expectOk } from "./expect.js";
export {
  CONFORMANCE_RP_ID,
  emptySponsor,
  type ProfileV0FixtureOptions,
  profileV0Fixtures,
  profileV0Identifiers,
} from "./fixtures/profile-v0.js";
export type {
  ConformanceIdentifiers,
  ConformanceSigners,
  ConformanceTarget,
  Credential,
  ProfileFixtures,
  TestBackend,
  TestClock,
  TestControls,
} from "./harness.js";
export { SCOPE_V0, type Scope, type ScopedId, SPEC_IDS, scopeProblems } from "./scope.v0.js";
export { runSuites, type Suite, type SuiteTest, suite } from "./suite.js";
export { createWorld, HarnessError, OPERATION_LIFETIME, register, type World } from "./world.js";

export const packageName = "@ticketto/conformance";
