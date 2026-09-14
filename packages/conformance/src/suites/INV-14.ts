// INV-14: provenance is immutable for the life of the ticket (REQ-TK-5).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, issue, issued, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-14", (test) => {
  test(
    "INV-14: a ticket keeps the provenance it was issued with; issuing again cannot change it",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const purchased = await issued(world, event, {
        placement: seat(world, 0),
        provenance: "Purchased",
      });
      const granted = await issued(world, event, {
        placement: seat(world, 1),
        provenance: "Granted",
      });
      expect((await ticketOf(world, purchased)).provenance).toBe("Purchased");
      expect((await ticketOf(world, granted)).provenance).toBe("Granted");

      await expectError(
        issue(world, event, { placement: seat(world, 0), provenance: "Granted" }).submission,
        "ERR-TicketIdExists",
      );
      await expectError(
        issue(world, event, { placement: seat(world, 1), provenance: "Purchased" }).submission,
        "ERR-TicketIdExists",
      );
      expect((await ticketOf(world, purchased)).provenance).toBe("Purchased");
      expect((await ticketOf(world, granted)).provenance).toBe("Granted");
    },
  );

  test(
    "INV-14: transfer and restriction removal leave provenance unchanged",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
        holder: holder.account,
      });
      await expectOk(
        world.ticketto.removeRestriction(world.organiser, {
          event,
          ticket,
          restriction: "cannotResale",
        }),
      );
      await expectOk(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
      );
      expect((await ticketOf(world, ticket)).provenance).toBe("Granted");
    },
  );
});
