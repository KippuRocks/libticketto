// ERR-EventSealed: a change not permitted while the event is Sealed — issuance, a
// capacity change, adding a zone (AC-A4.1, REQ-EV-8, AC-A6.5).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issue, issued, moveTo, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-EventSealed", (test) => {
  test(
    "ERR-EventSealed: a sealed event refuses issuance, capacity changes and new zones",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      const ticket = await issued(world, event, { placement: seat(world, 0) });
      await moveTo(world, event, "Sealed");
      const before = await eventOf(world, event);
      expect(before.status).toBe("Sealed");

      await expectError(
        issue(world, event, { placement: seat(world, 1) }).submission,
        "ERR-EventSealed",
      );
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 5, proof: null }),
        "ERR-EventSealed",
      );
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, {
          event,
          capacity: 20,
          proof: world.identifiers.proof(0),
        }),
        "ERR-EventSealed",
      );
      await expectError(
        world.ticketto.addZone(world.organiser, {
          event,
          zone: { id: world.identifiers.zone(2), kind: "Unseated" },
        }),
        "ERR-EventSealed",
      );
      expect(await eventOf(world, event)).toEqual(before);
      await ticketOf(world, ticket);
    },
  );

  test("ERR-EventSealed: transfer is not refused while sealed (AC-A4.2)", "M4", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event);
    await moveTo(world, event, "Sealed");
    const [from, to] = world.holders;
    if (from === undefined || to === undefined) throw new Error("fixtures need two holders");
    await expectOk(world.ticketto.transferTicket(from, { event, ticket, receiver: to.account }));
    expect((await ticketOf(world, ticket)).holder).toBe(to.account);
  });
});
