// AC-E3.2 (concurrency variant, features/004-conformance/plan.md §5.4): two
// operators submit the same pass concurrently — exactly one succeeds (INV-6).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { attendancesOf, createEventWith, issued, passFor, present, seat } from "../../steps.js";
import { suite } from "../../suite.js";
import { RUNS, race, randomFor } from "./random.js";

export default suite("AC-E3.2", (test) => {
  test(
    `AC-E3.2: gates submitting one pass concurrently — exactly one succeeds, over ${RUNS} randomised runs`,
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
        // Each gate scanned the code at its own instant within the window.
        const instants = random.shuffle(
          Array.from({ length: random.int(2, 6) }, (_, gate) => now - gate * 100),
        );
        const results = await race(
          random,
          instants.map((presentedAt) => () => present(world, signed, presentedAt)),
        );
        const settled = results.filter((result) => result.ok);
        const refused = results.flatMap((result) => (result.ok ? [] : [result.error.code]));
        expect(settled, `run ${run}: exactly one gate's submission is recorded`).toHaveLength(1);
        expect(new Set(refused), `run ${run}`).toEqual(
          new Set(refused.length > 0 ? ["ERR-PassReplayed"] : []),
        );
        expect(await attendancesOf(world, ticket), `run ${run}`).toBe(1);
      }
    },
    { timeout: 600_000 },
  );
});
