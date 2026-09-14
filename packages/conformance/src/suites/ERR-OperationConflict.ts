// ERR-OperationConflict: a command reusing an operation id already recorded for a
// different command (REQ-CM-1, amendment 0003).

import type { AddZone, Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, envelope, eventOf, sign, submitSigned } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-OperationConflict", (test) => {
  test(
    "ERR-OperationConflict: a different command under a recorded operation id fails and changes nothing",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const original: AddZone = {
        kind: "addZone",
        ...envelope(world),
        event,
        zone: { id: world.identifiers.zone(5), kind: "Seated" },
      };
      const signed = await sign(world, world.organiser, original);
      const receipt = await expectOk(submitSigned(world, signed));
      const before = await eventOf(world, event);

      const different: AddZone = {
        ...original,
        zone: { id: world.identifiers.zone(6), kind: "Seated" },
      };
      await expectError(
        submitSigned(world, await sign(world, world.organiser, different)),
        "ERR-OperationConflict",
      );
      expect(await eventOf(world, event)).toEqual(before);

      // The original stays recorded: replaying it is still a no-op.
      expect(await expectOk(submitSigned(world, signed))).toEqual(receipt);
    },
  );

  test(
    "ERR-OperationConflict: another account reusing a recorded operation id conflicts too",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const operation = envelope(world);
      await expectOk(
        submitSigned(
          world,
          await sign(world, world.organiser, {
            kind: "addZone",
            ...operation,
            event,
            zone: { id: world.identifiers.zone(5), kind: "Seated" },
          }),
        ),
      );
      const holder = world.holders[0] as Signer;
      const salt = world.identifiers.salt(1);
      await expectError(
        submitSigned(
          world,
          await sign(world, holder, {
            kind: "createEvent",
            ...operation,
            event: world.profile.eventId(holder.account, salt),
            salt,
            zones: [],
            capacity: null,
            metadata: null,
          }),
        ),
        "ERR-OperationConflict",
      );
      await expectError(
        world.ticketto.getEvent(world.profile.eventId(holder.account, salt)),
        "ERR-EventNotFound",
      );
    },
  );
});
