// ERR-TicketNotFound: an operation or query against a ticket that does not exist
// (§10, amendment 0003).

import type { Signer } from "@ticketto/sdk";
import { expectError } from "../expect.js";
import { createEventWith, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-TicketNotFound", (test) => {
  test("ERR-TicketNotFound: a ticket never issued is not found by query", "M1", async (world) => {
    const event = await createEventWith(world);
    const ticket = world.profile.ticketId(event, world.identifiers.zone(0), seat(world, 0));
    await expectError(world.ticketto.getTicket(ticket), "ERR-TicketNotFound");
  });

  test(
    "ERR-TicketNotFound: a ticket never issued is not found by transfer or restriction removal",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = world.profile.ticketId(event, world.identifiers.zone(0), seat(world, 0));
      const [holder, receiver] = world.holders as [Signer, Signer];
      await expectError(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
        "ERR-TicketNotFound",
      );
      await expectError(
        world.ticketto.removeRestriction(world.organiser, {
          event,
          ticket,
          restriction: "cannotResale",
        }),
        "ERR-TicketNotFound",
      );
    },
  );

  test(
    "ERR-TicketNotFound: a ticket never issued is not found by the gate's query",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = world.profile.ticketId(event, world.identifiers.zone(0), seat(world, 0));
      await expectError(world.ticketto.canAttend(event, ticket), "ERR-TicketNotFound");
    },
  );
});
