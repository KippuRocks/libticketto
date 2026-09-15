// T-005-08: backend-memory in F-001's conformance matrix (REQ-MG-1, NFR-8,
// REQ-SDK-7). The V0 suite runs against the in-memory backend under the V0
// profile, through the milestone reached — every test tagged up to it.
// `pnpm conformance` in this package runs this file (tools/conformance-matrix).

import { defineConformance, profileV0Fixtures } from "@ticketto/conformance";
import { createTestMemoryBackend } from "../src/testing/index.js";

const fixtures = profileV0Fixtures();

defineConformance(
  {
    name: "backend-memory × profile-v0",
    makeBackend: async () => createTestMemoryBackend({ profile: fixtures.profile }),
    ...fixtures,
  },
  { through: "M4" },
);
