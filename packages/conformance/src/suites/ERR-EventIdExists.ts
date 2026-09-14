// ERR-EventIdExists: creating an event whose derived EventId already exists
// (REQ-EV-9).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-EventIdExists", (test) => {
  test(
    "ERR-EventIdExists: a second creation with the same creator and salt fails and changes nothing",
    "M1",
    async (world) => {
      const event = await createEventWith(world, { salt: 3, capacity: 10 });
      const before = await eventOf(world, event);
      const again = world.ticketto.createEvent(world.organiser, {
        salt: world.identifiers.salt(3),
        zones: [{ id: world.identifiers.zone(5), kind: "Unseated" }],
        capacity: null,
        metadata: null,
      });
      expect(again.id).toBe(event);
      await expectError(again.submission, "ERR-EventIdExists");
      expect(await eventOf(world, event)).toEqual(before);
    },
  );

  test(
    "ERR-EventIdExists: another salt, or another creator, derives another event",
    "M1",
    async (world) => {
      const first = await createEventWith(world, { salt: 3 });
      const second = await createEventWith(world, { salt: 4 });
      const theirs = world.ticketto.createEvent(world.holders[0] ?? world.organiser, {
        salt: world.identifiers.salt(3),
        zones: [],
        capacity: null,
        metadata: null,
      });
      await expectOk(theirs.submission);
      expect(new Set([first, second, theirs.id]).size).toBe(3);
    },
  );
});
