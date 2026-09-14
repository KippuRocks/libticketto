// ERR-TicketIdExists: a ticket with this identity already exists — in a seated
// zone, the position is already issued (REQ-ID-2, AC-B5.1).

import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, standing, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-TicketIdExists", (test) => {
  test(
    "ERR-TicketIdExists: issuing an issued seat again fails and leaves the first ticket as it was",
    "M1",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      const ticket = await issued(world, event, { placement: seat(world, 7) });
      const before = await ticketOf(world, ticket);
      await expectError(
        issue(world, event, { placement: seat(world, 7) }).submission,
        "ERR-TicketIdExists",
      );
      expect(await ticketOf(world, ticket)).toEqual(before);
      expect((await eventOf(world, event)).issued).toBe(1);
    },
  );

  test(
    "ERR-TicketIdExists: an unseated discriminator already issued in its zone collides too",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const zone = world.identifiers.zone(1);
      await issued(world, event, { zone, placement: standing(world, 2) });
      await expectError(
        issue(world, event, { zone, placement: standing(world, 2), provenance: "Granted" })
          .submission,
        "ERR-TicketIdExists",
      );
      expect((await eventOf(world, event)).issued).toBe(1);
    },
  );
});
