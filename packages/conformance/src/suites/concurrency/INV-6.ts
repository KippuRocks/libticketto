// INV-6 (concurrency variant, features/004-conformance/plan.md §5.4): an access pass
// is consumed at most once, however many identical and distinct submissions of it
// race.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { attendancesOf, createEventWith, issued, passFor, present, seat } from "../../steps.js";
import { suite } from "../../suite.js";
import { RUNS, race, randomFor } from "./random.js";

export default suite("INV-6", (test) => {
  test(
    `INV-6: racing identical and distinct submissions of one pass consume it once, over ${RUNS} randomised runs`,
    "M3",
    async (world) => {
      const random = randomFor(world);
      const event = await createEventWith(world);
      const holder = world.holders[0] as Signer;
      for (let run = 0; run < RUNS; run++) {
        const ticket = await issued(world, event, {
          placement: seat(world, run),
          policy: { kind: "Unlimited", until: null },
          holder: holder.account,
        });
        const now = world.backend.clock.now();
        const signed = await passFor(world, ticket, {
          id: run,
          signer: holder,
          notBefore: now - 1_000,
        });
        const instants = Array.from(
          { length: random.int(2, 8) },
          () => now - random.int(0, 2) * 100,
        );
        const results = await race(
          random,
          instants.map((presentedAt) => () => present(world, signed, presentedAt)),
        );
        // Every settled submission is the one consumption: identical submissions share its receipt.
        const receipts = results.flatMap((result) =>
          result.ok ? [JSON.stringify(result.value)] : [],
        );
        expect(receipts.length, `run ${run}`).toBeGreaterThan(0);
        expect(new Set(receipts).size, `run ${run}`).toBe(1);
        for (const result of results) {
          if (!result.ok) expect(result.error.code, `run ${run}`).toBe("ERR-PassReplayed");
        }
        expect(await attendancesOf(world, ticket), `run ${run}`).toBe(1);
      }
    },
    { timeout: 600_000 },
  );
});
