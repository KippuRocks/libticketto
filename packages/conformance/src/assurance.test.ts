import { type AssuranceDeclaration, INVARIANT_IDS } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { fakeBackend } from "../test/fake-backend.js";
import { assuranceProblems } from "./assurance.js";
import { profileV0Fixtures } from "./fixtures/profile-v0.js";
import { runSuites } from "./suite.js";
import requirementSdk6 from "./suites/REQ-SDK-6.js";

// T-004-10: the completeness check, and the REQ-SDK-6 suite run against a
// backend whose declaration is complete.

const complete = Object.fromEntries(INVARIANT_IDS.map((id) => [id, "attested"]));

describe("assuranceProblems", () => {
  it("accepts a declaration with an entry for every invariant", () => {
    expect(assuranceProblems(complete)).toEqual([]);
  });

  it("fails a backend missing an invariant entry", async () => {
    const { "INV-6": _, ...missing } = complete;
    const backend = { ...(await fakeBackend()), assurance: missing as AssuranceDeclaration };
    expect(assuranceProblems(backend.assurance)).toEqual(["INV-6 has no entry"]);
  });

  it("fails an entry that is neither enforced nor attested, and one for no live invariant", () => {
    expect(assuranceProblems({ ...complete, "INV-3": "guaranteed" })).toEqual([
      'INV-3 is declared "guaranteed", not "enforced" or "attested"',
    ]);
    expect(assuranceProblems({ ...complete, "INV-9": "enforced" })).toEqual([
      "INV-9 is declared but is not a live invariant of §9",
    ]);
    expect(assuranceProblems(undefined)).toEqual(["the assurance declaration is not an object"]);
  });
});

runSuites(
  {
    name: "fake backend × profile-v0",
    makeBackend: async () => ({
      ...(await fakeBackend()),
      assurance: complete as AssuranceDeclaration,
    }),
    ...profileV0Fixtures(),
  },
  [requirementSdk6],
);
