// ERR-CapacityExceeded: issuance beyond max_capacity (AC-A1.3).

import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-CapacityExceeded", (test) => {
  test(
    "ERR-CapacityExceeded: issuance beyond capacity fails and records no ticket",
    "M1",
    async (world) => {
      const event = await createEventWith(world, { capacity: 1 });
      await issued(world, event, { placement: seat(world, 0) });
      const refused = issue(world, event, { placement: seat(world, 1) });
      await expectError(refused.submission, "ERR-CapacityExceeded");
      await expectError(world.ticketto.getTicket(refused.id), "ERR-TicketNotFound");
      expect((await eventOf(world, event)).issued).toBe(1);
    },
  );

  test("ERR-CapacityExceeded: a capacity of zero admits no ticket", "M1", async (world) => {
    const event = await createEventWith(world, { capacity: 0 });
    await expectError(issue(world, event).submission, "ERR-CapacityExceeded");
    expect((await eventOf(world, event)).issued).toBe(0);
  });
});
