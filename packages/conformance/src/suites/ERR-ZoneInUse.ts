// ERR-ZoneInUse: removal of a zone in which a ticket has been issued (REQ-ID-7).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, standing } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-ZoneInUse", (test) => {
  test("ERR-ZoneInUse: a zone with an issued ticket cannot be removed", "M1", async (world) => {
    const event = await createEventWith(world);
    const zone = world.identifiers.zone(1);
    await issued(world, event, { zone, placement: standing(world, 0) });
    const before = await eventOf(world, event);
    await expectError(world.ticketto.removeZone(world.organiser, { event, zone }), "ERR-ZoneInUse");
    expect(await eventOf(world, event)).toEqual(before);
  });

  test(
    "ERR-ZoneInUse: a zone nobody issued in is removed, and no longer issues",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const zone = world.identifiers.zone(0);
      await expectOk(world.ticketto.removeZone(world.organiser, { event, zone }));
      expect((await eventOf(world, event)).zones.map(({ id }) => id)).not.toContain(zone);
      await expectError(
        issue(world, event, { zone, placement: seat(world, 0) }).submission,
        "ERR-UnknownZone",
      );
    },
  );
});
