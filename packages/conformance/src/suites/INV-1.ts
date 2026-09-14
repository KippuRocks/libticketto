// INV-1: a ticket belongs to exactly one event, permanently.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, issued, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-1", (test) => {
  test(
    "INV-1: the same zone and placement in two events are two tickets, each of its own event",
    "M1",
    async (world) => {
      const first = await createEventWith(world, { salt: 0 });
      const second = await createEventWith(world, { salt: 1 });
      const a = await issued(world, first, { placement: seat(world, 0) });
      const b = await issued(world, second, { placement: seat(world, 0) });
      expect(a).not.toBe(b);
      expect((await ticketOf(world, a)).event).toBe(first);
      expect((await ticketOf(world, b)).event).toBe(second);
    },
  );

  test(
    "INV-1: a ticket named under another event is not found there, and stays in its own",
    "M4",
    async (world) => {
      const own = await createEventWith(world, { salt: 0 });
      const other = await createEventWith(world, { salt: 1 });
      const ticket = await issued(world, own, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
      });
      const [holder, receiver] = world.holders as [Signer, Signer];
      await expectError(
        world.ticketto.transferTicket(holder, { event: other, ticket, receiver: receiver.account }),
        "ERR-TicketNotFound",
      );
      await expectError(
        world.ticketto.removeRestriction(world.organiser, {
          event: other,
          ticket,
          restriction: "cannotResale",
        }),
        "ERR-TicketNotFound",
      );
      await expectOk(
        world.ticketto.transferTicket(holder, { event: own, ticket, receiver: receiver.account }),
      );
      expect((await ticketOf(world, ticket)).event).toBe(own);
    },
  );
});
