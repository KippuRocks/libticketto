import { INVARIANT_IDS, TICKETTO_ERROR_CODES } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { SCOPE_V0, type Scope, scopeProblems } from "./scope.v0.js";

// T-004-02 — features/004-conformance/plan.md §5.3: every live §9 and §10
// identifier is classified exactly once. This test is what fails CI.

describe("scope.v0", () => {
  it("classifies every live §9 invariant and §10 error exactly once", () => {
    expect(scopeProblems(SCOPE_V0)).toEqual([]);
  });

  it("covers the whole spec between its two lists", () => {
    const classified =
      SCOPE_V0.invariants.length + SCOPE_V0.errors.length + Object.keys(SCOPE_V0.outOfScope).length;
    expect(classified).toBe(INVARIANT_IDS.length + TICKETTO_ERROR_CODES.length);
  });

  it("fails when an id is removed from both lists", () => {
    const withoutInvariant: Scope = {
      ...SCOPE_V0,
      invariants: SCOPE_V0.invariants.filter((id) => id !== "INV-13"),
    };
    expect(scopeProblems(withoutInvariant)).toEqual([
      "INV-13 is neither in scope nor out of scope",
    ]);

    const { "ERR-CannotPay": _, ...outOfScope } = SCOPE_V0.outOfScope;
    expect(scopeProblems({ ...SCOPE_V0, outOfScope })).toEqual([
      "ERR-CannotPay is neither in scope nor out of scope",
    ]);
  });

  it("fails when an id is in both lists, listed twice, unknown, or out of scope without a reason", () => {
    expect(
      scopeProblems({ ...SCOPE_V0, outOfScope: { ...SCOPE_V0.outOfScope, "INV-4": "because" } }),
    ).toEqual(["INV-4 is both in scope and out of scope"]);
    expect(scopeProblems({ ...SCOPE_V0, invariants: [...SCOPE_V0.invariants, "INV-4"] })).toEqual([
      "INV-4 is listed in scope 2 times",
    ]);
    expect(
      scopeProblems({ ...SCOPE_V0, outOfScope: { ...SCOPE_V0.outOfScope, "INV-7": " " } }),
    ).toEqual(["INV-7 is out of scope without a reason"]);
    expect(
      scopeProblems(SCOPE_V0, [
        ...INVARIANT_IDS.filter((id) => id !== "INV-16"),
        ...TICKETTO_ERROR_CODES,
      ]),
    ).toEqual(["INV-16 is in scope but is not a live identifier of the spec"]);
  });

  it("fails when a platform or binding error is put in scope", () => {
    const { "ERR-LedgerUnavailable": _, ...outOfScope } = SCOPE_V0.outOfScope;
    expect(
      scopeProblems({
        ...SCOPE_V0,
        errors: [...SCOPE_V0.errors, "ERR-LedgerUnavailable"],
        outOfScope,
      }),
    ).toEqual([
      "ERR-LedgerUnavailable is in scope but is a binding error, which no ledger raises (§10 note)",
    ]);
  });
});
