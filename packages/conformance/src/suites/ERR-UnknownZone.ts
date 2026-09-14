// ERR-UnknownZone: issuance against a zone not defined for the event (REQ-ID-7).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-UnknownZone", (test) => {
  test(
    "ERR-UnknownZone: issuance into a zone the event does not define fails",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const undefinedZone = world.identifiers.zone(9);
      const refused = issue(world, event, { zone: undefinedZone, placement: seat(world, 0) });
      await expectError(refused.submission, "ERR-UnknownZone");
      await expectError(world.ticketto.getTicket(refused.id), "ERR-TicketNotFound");
      expect((await eventOf(world, event)).issued).toBe(0);
    },
  );

  test("ERR-UnknownZone: a zone of another event is unknown to this one", "M1", async (world) => {
    const event = await createEventWith(world, {
      salt: 0,
      zones: [{ id: world.identifiers.zone(0), kind: "Seated" }],
    });
    await createEventWith(world, {
      salt: 1,
      zones: [{ id: world.identifiers.zone(3), kind: "Seated" }],
    });
    await expectError(
      issue(world, event, { zone: world.identifiers.zone(3), placement: seat(world, 0) })
        .submission,
      "ERR-UnknownZone",
    );
  });

  test(
    "ERR-UnknownZone: removing a zone the event does not define fails; once added, it issues",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const zone = world.identifiers.zone(4);
      await expectError(
        world.ticketto.removeZone(world.organiser, { event, zone }),
        "ERR-UnknownZone",
      );
      await expectOk(
        world.ticketto.addZone(world.organiser, { event, zone: { id: zone, kind: "Seated" } }),
      );
      await issued(world, event, { zone, placement: seat(world, 0) });
    },
  );
});
