// ERR-EventCancelled: issuance, a capacity change, or adding a zone against a
// cancelled event (REQ-EV-8, AC-A5.1, AC-A6.5). Attendance against a cancelled
// event is the gate suites' (T-004-06).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issue, issued, moveTo, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-EventCancelled", (test) => {
  test(
    "ERR-EventCancelled: a cancelled event refuses issuance, capacity changes and new zones",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      await issued(world, event, { placement: seat(world, 0) });
      await moveTo(world, event, "Cancelled");
      const before = await eventOf(world, event);
      expect(before.status).toBe("Cancelled");

      await expectError(
        issue(world, event, { placement: seat(world, 1) }).submission,
        "ERR-EventCancelled",
      );
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 5, proof: null }),
        "ERR-EventCancelled",
      );
      await expectError(
        world.ticketto.addZone(world.organiser, {
          event,
          zone: { id: world.identifiers.zone(2), kind: "Seated" },
        }),
        "ERR-EventCancelled",
      );
      expect(await eventOf(world, event)).toEqual(before);
    },
  );

  test(
    "ERR-EventCancelled: a sealed event cancels, and transfer is not refused (AC-A5.4)",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event);
      await moveTo(world, event, "Sealed", "Cancelled");
      expect((await eventOf(world, event)).status).toBe("Cancelled");
      const [from, to] = world.holders;
      if (from === undefined || to === undefined) throw new Error("fixtures need two holders");
      await expectOk(world.ticketto.transferTicket(from, { event, ticket, receiver: to.account }));
      expect((await ticketOf(world, ticket)).holder).toBe(to.account);
    },
  );
});
