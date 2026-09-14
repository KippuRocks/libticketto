// INV-16: no ledger state of a Finished event, or of any of its tickets, may
// change (AC-A5.6, AC-A5.7, REQ-EV-11).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, moveTo, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-16", (test) => {
  test(
    "INV-16: after finishing, the event and its tickets read back unchanged whatever is attempted",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 5 });
      const ticket = await issued(world, event, {
        placement: seat(world, 0),
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
      });
      await moveTo(world, event, "Finished");
      const eventBefore = await eventOf(world, event);
      const ticketBefore = await ticketOf(world, ticket);
      const { ticketto, organiser } = world;

      for (const status of ["Active", "Sealed", "Cancelled", "Finished"] as const) {
        await expectError(
          ticketto.setEventStatus(organiser, { event, status }),
          "ERR-EventFinished",
        );
      }
      await expectError(
        ticketto.setEventCapacity(organiser, {
          event,
          capacity: 9,
          proof: world.identifiers.proof(0),
        }),
        "ERR-EventFinished",
      );
      await expectError(
        issue(world, event, { placement: seat(world, 1) }).submission,
        "ERR-EventFinished",
      );
      await expectError(
        ticketto.removeRestriction(organiser, { event, ticket, restriction: "cannotTransfer" }),
        "ERR-EventFinished",
      );
      await expectError(
        ticketto.transferTicket(world.holders[0] as Signer, {
          event,
          ticket,
          receiver: (world.holders[1] as Signer).account,
        }),
        "ERR-EventFinished",
      );

      expect(await eventOf(world, event)).toEqual(eventBefore);
      expect(await ticketOf(world, ticket)).toEqual(ticketBefore);
    },
  );
});
