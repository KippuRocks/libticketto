// T-005-04: the assurance declaration mirrors §4.4's hosted column (REQ-SDK-6;
// features/005-backend-memory/plan.md §5.3).

import { assuranceProblems } from "@ticketto/conformance";
import { createProfileV0 } from "@ticketto/profile-v0";
import { INVARIANT_IDS } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createMemoryBackend } from "./index.js";

const backend = createMemoryBackend({ profile: createProfileV0({ rpId: "backend-memory.test" }) });

describe("in-memory backend: assurance declaration", () => {
  it("REQ-SDK-6: declares every generated invariant id, and nothing else", () => {
    expect(assuranceProblems(backend.assurance)).toEqual([]);
    expect(Object.keys(backend.assurance).sort()).toEqual([...INVARIANT_IDS].sort());
    for (const id of INVARIANT_IDS) {
      expect(["enforced", "attested"]).toContain(backend.assurance[id]);
    }
  });

  it("INV-6, INV-7: enforced by the single in-process authority, as §4.4 claims for the hosted backend", () => {
    expect(backend.assurance["INV-6"]).toBe("enforced");
    expect(backend.assurance["INV-7"]).toBe("enforced");
  });

  it("INV-3: attested, as §4.4 marks it for the hosted backend", () => {
    expect(backend.assurance["INV-3"]).toBe("attested");
  });

  it("claims no more than §4.4's hosted column: every other invariant is attested", () => {
    const enforced = INVARIANT_IDS.filter((id) => backend.assurance[id] === "enforced");
    expect(enforced).toEqual(["INV-6", "INV-7"]);
  });

  it("cannot be changed by a caller", () => {
    expect(Object.isFrozen(backend.assurance)).toBe(true);
  });
});
