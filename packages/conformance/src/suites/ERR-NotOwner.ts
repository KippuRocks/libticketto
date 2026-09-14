// ERR-NotOwner: the caller lacks rights over the event or ticket.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-NotOwner", (test) => {
  test(
    "ERR-NotOwner: only the event's owner issues tickets and adds or removes zones",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const intruder = world.holders[2] as Signer;
      const before = await eventOf(world, event);

      const refused = issue(world, event, { signer: intruder, holder: intruder.account });
      await expectError(refused.submission, "ERR-NotOwner");
      await expectError(world.ticketto.getTicket(refused.id), "ERR-TicketNotFound");
      await expectError(
        world.ticketto.addZone(intruder, {
          event,
          zone: { id: world.identifiers.zone(2), kind: "Seated" },
        }),
        "ERR-NotOwner",
      );
      await expectError(
        world.ticketto.removeZone(intruder, { event, zone: world.identifiers.zone(1) }),
        "ERR-NotOwner",
      );
      expect(await eventOf(world, event)).toEqual(before);
    },
  );

  test(
    "ERR-NotOwner: another organiser's account has no rights over the event",
    "M1",
    async (world) => {
      const other = world.holders[1] as Signer;
      const theirs = await createEventWith(world, { signer: other, salt: 7 });
      expect((await eventOf(world, theirs)).owner).toBe(other.account);
      await expectError(issue(world, theirs).submission, "ERR-NotOwner");
    },
  );

  test(
    "ERR-NotOwner: only the owner changes status or capacity, or removes a restriction",
    "M4",
    async (world) => {
      const event = await createEventWith(world, { capacity: 5 });
      const ticket = await issued(world, event, {
        placement: seat(world, 0),
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
      });
      const intruder = world.holders[2] as Signer;
      const eventBefore = await eventOf(world, event);
      await expectError(
        world.ticketto.setEventStatus(intruder, { event, status: "Cancelled" }),
        "ERR-NotOwner",
      );
      await expectError(
        world.ticketto.setEventCapacity(intruder, { event, capacity: 3, proof: null }),
        "ERR-NotOwner",
      );
      await expectError(
        world.ticketto.removeRestriction(intruder, { event, ticket, restriction: "cannotResale" }),
        "ERR-NotOwner",
      );
      expect(await eventOf(world, event)).toEqual(eventBefore);
      expect((await ticketOf(world, ticket)).restrictions.cannotResale).toBe(true);
    },
  );

  test(
    "ERR-NotOwner: only the holder transfers a ticket — not the organiser, not anyone else",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, other, intruder] = world.holders as [Signer, Signer, Signer];
      const ticket = await issued(world, event, { holder: holder.account });
      for (const signer of [world.organiser, intruder]) {
        await expectError(
          world.ticketto.transferTicket(signer, { event, ticket, receiver: other.account }),
          "ERR-NotOwner",
        );
      }
      expect((await ticketOf(world, ticket)).holder).toBe(holder.account);
    },
  );
});
