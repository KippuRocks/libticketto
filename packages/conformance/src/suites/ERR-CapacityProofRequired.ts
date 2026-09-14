// ERR-CapacityProofRequired: a capacity increase without a validated venue proof
// (AC-A6.3, REQ-EV-5, REQ-EV-7).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-CapacityProofRequired", (test) => {
  test(
    "ERR-CapacityProofRequired: raising capacity without a proof fails and changes nothing",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 11, proof: null }),
        "ERR-CapacityProofRequired",
      );
      expect((await eventOf(world, event)).maxCapacity).toBe(10);
    },
  );

  test(
    "ERR-CapacityProofRequired: removing the bound counts as an increase",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: null, proof: null }),
        "ERR-CapacityProofRequired",
      );
      expect((await eventOf(world, event)).maxCapacity).toBe(10);
    },
  );

  test(
    "ERR-CapacityProofRequired: an increase with a proof succeeds; a decrease needs none",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      await expectOk(
        world.ticketto.setEventCapacity(world.organiser, {
          event,
          capacity: 20,
          proof: world.identifiers.proof(0),
        }),
      );
      await expectOk(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 15, proof: null }),
      );
      expect((await eventOf(world, event)).maxCapacity).toBe(15);
    },
  );
});
