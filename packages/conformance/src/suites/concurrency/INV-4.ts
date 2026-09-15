// INV-4 (concurrency variant, features/004-conformance/plan.md §5.4): issuance racing
// at the capacity boundary never exceeds capacity.

import { expect } from "vitest";
import { createEventWith, eventOf, issue, seat } from "../../steps.js";
import { suite } from "../../suite.js";
import { RUNS, race, randomFor } from "./random.js";

export default suite("INV-4", (test) => {
  test(
    `INV-4: concurrent issuance at the capacity boundary issues exactly capacity, over ${RUNS} randomised runs`,
    "M1",
    async (world) => {
      const random = randomFor(world);
      for (let run = 0; run < RUNS; run++) {
        const capacity = random.int(1, 3);
        const attempts = capacity + random.int(1, 3);
        const event = await createEventWith(world, { salt: run, capacity });
        const results = await race(
          random,
          Array.from(
            { length: attempts },
            (_, index) => () => issue(world, event, { placement: seat(world, index) }).submission,
          ),
        );
        const settled = results.filter((result) => result.ok).length;
        for (const result of results) {
          if (!result.ok) expect(result.error.code, `run ${run}`).toBe("ERR-CapacityExceeded");
        }
        expect(settled, `run ${run}`).toBe(capacity);
        expect(await eventOf(world, event), `run ${run}`).toMatchObject({
          issued: capacity,
          maxCapacity: capacity,
        });
      }
    },
    { timeout: 600_000 },
  );
});
