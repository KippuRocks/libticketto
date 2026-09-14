// INV-11: max_capacity MUST NOT be set below issued; decrease is free above that
// floor; increase requires a validated capacity proof (US-A6, AC-A6.1–AC-A6.4).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issued, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-11", (test) => {
  test(
    "INV-11: capacity lowers freely to issued, never below, and rises only with a proof",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      await issued(world, event, { placement: seat(world, 0) });
      await issued(world, event, { placement: seat(world, 1) });
      const setCapacity = (capacity: number | null, proof: number | null) =>
        world.ticketto.setEventCapacity(world.organiser, {
          event,
          capacity,
          proof: proof === null ? null : world.identifiers.proof(proof),
        });

      await expectOk(setCapacity(5, null));
      await expectOk(setCapacity(2, null));
      await expectError(setCapacity(1, null), "ERR-CapacityBelowIssuance");
      await expectError(setCapacity(3, null), "ERR-CapacityProofRequired");
      await expectError(setCapacity(null, null), "ERR-CapacityProofRequired");
      expect(await eventOf(world, event)).toMatchObject({ maxCapacity: 2, issued: 2 });

      await expectOk(setCapacity(8, 0));
      expect((await eventOf(world, event)).maxCapacity).toBe(8);
      await expectOk(setCapacity(null, 1));
      expect((await eventOf(world, event)).maxCapacity).toBeNull();
    },
  );

  test("INV-11: a proof does not permit a capacity below issued", "M4", async (world) => {
    const event = await createEventWith(world, { capacity: 4 });
    await issued(world, event, { placement: seat(world, 0) });
    await issued(world, event, { placement: seat(world, 1) });
    await expectError(
      world.ticketto.setEventCapacity(world.organiser, {
        event,
        capacity: 1,
        proof: world.identifiers.proof(0),
      }),
      "ERR-CapacityBelowIssuance",
    );
    expect(await eventOf(world, event)).toMatchObject({ maxCapacity: 4, issued: 2 });
  });
});
