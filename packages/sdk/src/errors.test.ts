import { describe, expect, expectTypeOf, it } from "vitest";
import {
  INVARIANT_IDS,
  type InvariantId,
  type Result,
  TICKETTO_ERROR_CODES,
  TICKETTO_ERROR_ORIGINS,
  type TickettoError,
  type TickettoErrorCode,
} from "./index.js";

describe("generated error codes (SPEC.md §10)", () => {
  it("excludes tombstoned rows: ERR-CannotPay exists and ERR-BalanceLow does not", () => {
    expect(TICKETTO_ERROR_CODES).toContain("ERR-CannotPay");
    expect(TICKETTO_ERROR_CODES).not.toContain("ERR-BalanceLow");
    expect(TICKETTO_ERROR_CODES).not.toContain("ERR-TicketFormatError");
    expectTypeOf<"ERR-CannotPay">().toExtend<TickettoErrorCode>();
    // @ts-expect-error — a renamed error is not a code.
    const renamed: TickettoErrorCode = "ERR-BalanceLow";
    expect(renamed).toBeDefined();
  });

  it("carries the codes amendment 0003 added", () => {
    for (const code of [
      "ERR-OperationExpired",
      "ERR-InvalidAuthorisation",
      "ERR-LedgerUnavailable",
    ]) {
      expect(TICKETTO_ERROR_CODES).toContain(code);
    }
  });

  it("tags every code with where it arises, per §10's note", () => {
    expect(Object.keys(TICKETTO_ERROR_ORIGINS).sort()).toEqual([...TICKETTO_ERROR_CODES].sort());
    const by = (origin: string) =>
      TICKETTO_ERROR_CODES.filter((code) => TICKETTO_ERROR_ORIGINS[code] === origin).sort();
    expect(by("platform")).toEqual(["ERR-ClassQuotaExceeded", "ERR-UnknownClass"]);
    expect(by("binding")).toEqual(["ERR-LedgerUnavailable"]);
    expect(by("ledger")).toHaveLength(TICKETTO_ERROR_CODES.length - 3);
  });
});

describe("generated invariant ids (SPEC.md §9)", () => {
  it("excludes the withdrawn INV-9", () => {
    expect(INVARIANT_IDS).not.toContain("INV-9");
    expect([...INVARIANT_IDS].sort()).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16].map((n) => `INV-${n}`).sort(),
    );
    expectTypeOf<"INV-3">().toExtend<InvariantId>();
  });
});

describe("Result and TickettoError", () => {
  it("is a value discriminated on ok", () => {
    const result = { ok: false, error: { code: "ERR-NotOwner" } } as Result<number>;
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<TickettoError>();
      expectTypeOf(result.error.code).toEqualTypeOf<TickettoErrorCode>();
    }
    expect(result.ok).toBe(false);
  });

  it("refuses an error code that is not in §10", () => {
    // @ts-expect-error — not a spec error.
    const error: TickettoError = { code: "ERR-Timeout" };
    expect(error).toBeDefined();
  });
});
