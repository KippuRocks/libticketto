// ERR-CapacityBelowIssuance: capacity set below tickets already issued (AC-A6.2).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issued, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-CapacityBelowIssuance", (test) => {
  test(
    "ERR-CapacityBelowIssuance: capacity set below issued fails and changes nothing",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 3 });
      const tickets = [
        await issued(world, event, { placement: seat(world, 0) }),
        await issued(world, event, { placement: seat(world, 1) }),
        await issued(world, event, { placement: seat(world, 2) }),
      ];
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 2, proof: null }),
        "ERR-CapacityBelowIssuance",
      );
      expect(await eventOf(world, event)).toMatchObject({ maxCapacity: 3, issued: 3 });
      for (const ticket of tickets) await ticketOf(world, ticket);
    },
  );

  test(
    "ERR-CapacityBelowIssuance: capacity set exactly to issued succeeds",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 3 });
      await issued(world, event, { placement: seat(world, 0) });
      await expectOk(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 1, proof: null }),
      );
      expect((await eventOf(world, event)).maxCapacity).toBe(1);
    },
  );
});
