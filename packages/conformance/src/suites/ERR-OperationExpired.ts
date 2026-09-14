// ERR-OperationExpired: a command submitted after its own expiry (REQ-CM-1,
// AD-15).

import type { AddZone } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, envelope, eventOf, sign, submitSigned } from "../steps.js";
import { suite } from "../suite.js";
import type { World } from "../world.js";

async function addZoneCommand(world: World, index: number): Promise<AddZone> {
  const event = await createEventWith(world, { salt: index });
  return {
    kind: "addZone",
    ...envelope(world),
    event,
    zone: { id: world.identifiers.zone(5), kind: "Seated" },
  };
}

export default suite("ERR-OperationExpired", (test) => {
  test(
    "ERR-OperationExpired: a command submitted after its expiry fails and changes nothing",
    "M1",
    async (world) => {
      const command = await addZoneCommand(world, 0);
      const signed = await sign(world, world.organiser, command);
      const before = await eventOf(world, command.event);
      world.backend.clock.set(command.expiresAt + 1);
      await expectError(submitSigned(world, signed), "ERR-OperationExpired");
      expect(await eventOf(world, command.event)).toEqual(before);
    },
  );

  test(
    "ERR-OperationExpired: a command submitted at its expiry instant is not yet expired",
    "M1",
    async (world) => {
      const command = await addZoneCommand(world, 0);
      const signed = await sign(world, world.organiser, command);
      world.backend.clock.set(command.expiresAt);
      await expectOk(submitSigned(world, signed));
    },
  );

  test(
    "ERR-OperationExpired: an identical replay after the expiry is rejected, not applied again",
    "M1",
    async (world) => {
      const command = await addZoneCommand(world, 0);
      const signed = await sign(world, world.organiser, command);
      await expectOk(submitSigned(world, signed));
      const before = await eventOf(world, command.event);
      world.backend.clock.set(command.expiresAt + 1);
      await expectError(submitSigned(world, signed), "ERR-OperationExpired");
      expect(await eventOf(world, command.event)).toEqual(before);
    },
  );
});
