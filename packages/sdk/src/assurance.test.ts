import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type Assurance,
  type AssuranceDeclaration,
  type Backend,
  INVARIANT_IDS,
  type InvariantId,
} from "./index.js";

// A complete declaration, for its shape only. What each backend actually
// declares is that backend's to state (SPEC.md §4.4).
const complete = {
  "INV-1": "attested",
  "INV-2": "attested",
  "INV-3": "attested",
  "INV-4": "attested",
  "INV-5": "attested",
  "INV-6": "attested",
  "INV-7": "attested",
  "INV-8": "attested",
  "INV-10": "attested",
  "INV-11": "attested",
  "INV-12": "attested",
  "INV-13": "attested",
  "INV-14": "attested",
  "INV-15": "attested",
  "INV-16": "attested",
} as const satisfies AssuranceDeclaration;

describe("the assurance declaration (REQ-SDK-6, plan §5.9)", () => {
  it("is keyed by exactly the generated invariant ids", () => {
    expectTypeOf<keyof AssuranceDeclaration>().toEqualTypeOf<InvariantId>();
    expect(Object.keys(complete).sort()).toEqual([...INVARIANT_IDS].sort());
  });

  it("declares each invariant enforced or attested", () => {
    expectTypeOf<AssuranceDeclaration[InvariantId]>().toEqualTypeOf<Assurance>();
    expectTypeOf<Assurance>().toEqualTypeOf<"enforced" | "attested">();
  });

  it("fails to compile when an invariant has no declaration entry", () => {
    const { "INV-16": _, ...missing } = complete;
    // @ts-expect-error — INV-16 is undeclared.
    const incomplete: AssuranceDeclaration = missing;
    expect(incomplete).toBeDefined();
  });

  it("fails to compile when the spec adds an invariant the declaration does not cover", () => {
    // What regenerating from a spec with a new INV-17 does to InvariantId.
    type WithNewInvariant = { readonly [Invariant in InvariantId | "INV-17"]: Assurance };
    // @ts-expect-error — INV-17 is undeclared.
    const stale: WithNewInvariant = complete;
    expect(stale).toBeDefined();
  });

  it("refuses an invariant the spec does not have, such as the withdrawn INV-9", () => {
    // @ts-expect-error — INV-9 is withdrawn.
    const withdrawn: AssuranceDeclaration = { ...complete, "INV-9": "attested" };
    expect(withdrawn).toBeDefined();
  });

  it("is part of the backend port", () => {
    expectTypeOf<Backend["assurance"]>().toEqualTypeOf<AssuranceDeclaration>();
  });
});
