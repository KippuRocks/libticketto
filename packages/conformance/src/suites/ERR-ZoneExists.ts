// ERR-ZoneExists: adding a zone whose id already exists in the event, or creating
// an event that names a zone twice (REQ-ID-7, amendment 0003).

import type { EventId } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-ZoneExists", (test) => {
  test(
    "ERR-ZoneExists: adding a zone id the event has fails, whatever its kind, and changes nothing",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const before = await eventOf(world, event);
      for (const kind of ["Seated", "Unseated"] as const) {
        await expectError(
          world.ticketto.addZone(world.organiser, {
            event,
            zone: { id: world.identifiers.zone(0), kind },
          }),
          "ERR-ZoneExists",
        );
      }
      expect(await eventOf(world, event)).toEqual(before);
    },
  );

  test(
    "ERR-ZoneExists: creating an event that names a zone twice fails, and no event exists",
    "M1",
    async (world) => {
      const zone = world.identifiers.zone(0);
      const { id, submission } = world.ticketto.createEvent(world.organiser, {
        salt: world.identifiers.salt(0),
        zones: [
          { id: zone, kind: "Seated" },
          { id: zone, kind: "Unseated" },
        ],
        capacity: null,
        metadata: null,
      });
      await expectError(submission, "ERR-ZoneExists");
      await expectError(world.ticketto.getEvent(id as EventId), "ERR-EventNotFound");
    },
  );
});
