// ERR-RestrictionNotPermitted: a restriction attempted on a purchased ticket
// (INV-12, AC-B3.1).

import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-RestrictionNotPermitted", (test) => {
  test(
    "ERR-RestrictionNotPermitted: a purchased ticket issued with any restriction fails and records nothing",
    "M1",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      for (const [index, restrictions] of [
        { cannotResale: true, cannotTransfer: false },
        { cannotResale: false, cannotTransfer: true },
        { cannotResale: true, cannotTransfer: true },
      ].entries()) {
        const refused = issue(world, event, {
          placement: seat(world, index),
          provenance: "Purchased",
          restrictions,
        });
        await expectError(refused.submission, "ERR-RestrictionNotPermitted");
        await expectError(world.ticketto.getTicket(refused.id), "ERR-TicketNotFound");
      }
      expect((await eventOf(world, event)).issued).toBe(0);
    },
  );
});
