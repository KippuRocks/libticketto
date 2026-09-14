import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AssuranceDeclaration,
  type Backend,
  INVARIANT_IDS,
  type Migration,
  type MigrationFailureReason,
  type MigrationResult,
} from "./index.js";
import { exportLedger, importLedger } from "./migration.js";

// T-002-13 — features/002-sdk/plan.md §5.8a. Done when: API report updated;
// exporting from a backend without `migration` fails with a typed reason.

function backend(migration?: Migration): Backend {
  return {
    submit() {
      throw new Error("not used");
    },
    async query() {
      return { ok: false, error: { code: "ERR-LedgerUnavailable" } };
    },
    log: {
      async read(from) {
        return { ok: true, value: { records: [], next: from } };
      },
      async *hints() {},
    },
    assurance: Object.fromEntries(
      INVARIANT_IDS.map((id) => [id, "attested"]),
    ) as AssuranceDeclaration,
    ...(migration === undefined ? {} : { migration }),
  };
}

async function* chunks(...parts: number[][]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield Uint8Array.from(part);
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[][]> {
  const out: number[][] = [];
  for await (const chunk of stream) out.push([...chunk]);
  return out;
}

describe("migration (REQ-MG-3, plan §5.8a)", () => {
  it("exporting from a backend without migration fails with the typed reason unsupported", () => {
    const result = exportLedger(backend());
    expect(result).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("importing into a backend without migration fails with the typed reason unsupported", async () => {
    expect(await importLedger(backend(), chunks([1]))).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("exports a backend's stream as it produces it, bytes untouched", async () => {
    const result = exportLedger(
      backend({
        export: () => chunks([0, 1], [2]),
        import: async () => ({ ok: true }),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(await collect(result.stream)).toEqual([[0, 1], [2]]);
  });

  it("hands the stream to the backend's import and returns its result, success or typed failure", async () => {
    const seen: number[][][] = [];
    const refusing: MigrationResult = { ok: false, reason: "notEmpty", detail: "holds state" };
    let answer: MigrationResult = { ok: true };
    const target = backend({
      export: () => chunks(),
      async import(stream) {
        seen.push(await collect(stream));
        return answer;
      },
    });
    expect(await importLedger(target, chunks([9], [8, 7]))).toEqual({ ok: true });
    answer = refusing;
    expect(await importLedger(target, chunks([6]))).toEqual(refusing);
    expect(seen).toEqual([[[9], [8, 7]], [[6]]]);
  });

  it("types failures as reasons, never as §10 errors", () => {
    expectTypeOf<MigrationFailureReason>().toEqualTypeOf<
      "unsupported" | "notEmpty" | "malformed"
    >();
    expectTypeOf<Extract<MigrationResult, { ok: false }>>().not.toHaveProperty("error");
    expectTypeOf<Backend["migration"]>().toEqualTypeOf<Migration | undefined>();
    expectTypeOf<Migration["export"]>().returns.toEqualTypeOf<AsyncIterable<Uint8Array>>();
  });
});
