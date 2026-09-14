// ERR-ZoneKindMismatch: a placement that does not match its zone's kind (REQ-ID-7).

import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, seat, standing } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-ZoneKindMismatch", (test) => {
  test(
    "ERR-ZoneKindMismatch: an unseated placement in a seated zone, and a seat in an unseated zone, fail",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const seatedZone = world.identifiers.zone(0);
      const unseatedZone = world.identifiers.zone(1);
      const inSeated = issue(world, event, { zone: seatedZone, placement: standing(world, 0) });
      await expectError(inSeated.submission, "ERR-ZoneKindMismatch");
      const inUnseated = issue(world, event, { zone: unseatedZone, placement: seat(world, 0) });
      await expectError(inUnseated.submission, "ERR-ZoneKindMismatch");
      await expectError(world.ticketto.getTicket(inSeated.id), "ERR-TicketNotFound");
      await expectError(world.ticketto.getTicket(inUnseated.id), "ERR-TicketNotFound");
      expect((await eventOf(world, event)).issued).toBe(0);
    },
  );
});
