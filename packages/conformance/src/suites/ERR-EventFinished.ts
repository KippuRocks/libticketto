// ERR-EventFinished: any state-changing operation against a Finished event or its
// tickets (AC-A5.7, INV-16).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, moveTo, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-EventFinished", (test) => {
  test(
    "ERR-EventFinished: every command against a finished event or its tickets fails",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 10 });
      const holder = world.holders[0] as Signer;
      const receiver = world.holders[1] as Signer;
      const ticket = await issued(world, event, {
        placement: seat(world, 0),
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
      });
      await moveTo(world, event, "Finished");
      const { ticketto, organiser } = world;

      const attempts = [
        ticketto.setEventStatus(organiser, { event, status: "Cancelled" }),
        ticketto.setEventCapacity(organiser, { event, capacity: 5, proof: null }),
        ticketto.addZone(organiser, {
          event,
          zone: { id: world.identifiers.zone(2), kind: "Seated" },
        }),
        ticketto.removeZone(organiser, { event, zone: world.identifiers.zone(1) }),
        issue(world, event, { placement: seat(world, 1) }).submission,
        ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
        ticketto.removeRestriction(organiser, { event, ticket, restriction: "cannotResale" }),
      ];
      for (const attempt of attempts) await expectError(attempt, "ERR-EventFinished");
    },
  );

  test(
    "ERR-EventFinished: a sealed event finishes, and then refuses every change",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      await moveTo(world, event, "Sealed", "Finished");
      const before = await eventOf(world, event);
      expect(before.status).toBe("Finished");
      await expectError(
        world.ticketto.setEventStatus(world.organiser, { event, status: "Finished" }),
        "ERR-EventFinished",
      );
      expect(await eventOf(world, event)).toEqual(before);
    },
  );
});
