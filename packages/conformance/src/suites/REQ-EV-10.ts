// REQ-EV-10: cancelling an event fixes, as a ledger fact, the holder of each of its
// tickets at the moment of cancellation; transfers afterwards do not change it
// (features/008-ledger-rules/plan.md §5.5).

import type { EventId, Signer, TicketId } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, issued, moveTo, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";
import type { World } from "../world.js";

function transfer(world: World, from: Signer, to: Signer, event: EventId, ticket: TicketId) {
  return expectOk(world.ticketto.transferTicket(from, { event, ticket, receiver: to.account }));
}

export default suite("REQ-EV-10", (test) => {
  test(
    "REQ-EV-10: no holder is fixed while the event is not cancelled, whatever transfers happen",
    "M4",
    async (world) => {
      const [a, b] = world.holders as [Signer, Signer];
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { holder: a.account });
      expect(await expectOk(world.ticketto.getCancellationHolder(ticket))).toBeNull();
      await transfer(world, a, b, event, ticket);
      await moveTo(world, event, "Sealed");
      expect(await expectOk(world.ticketto.getCancellationHolder(ticket))).toBeNull();
    },
  );

  test(
    "REQ-EV-10: at cancellation, the fixed holder is the ticket's holder then",
    "M4",
    async (world) => {
      const [a, b] = world.holders as [Signer, Signer];
      const event = await createEventWith(world);
      const untouched = await issued(world, event, {
        placement: seat(world, 0),
        holder: a.account,
      });
      const movedBefore = await issued(world, event, {
        placement: seat(world, 1),
        holder: a.account,
      });
      await transfer(world, a, b, event, movedBefore);
      await moveTo(world, event, "Cancelled");
      expect(await expectOk(world.ticketto.getCancellationHolder(untouched))).toBe(a.account);
      expect(await expectOk(world.ticketto.getCancellationHolder(movedBefore))).toBe(b.account);
    },
  );

  test(
    "REQ-EV-10: transfers after cancellation leave the fixed holder unchanged",
    "M4",
    async (world) => {
      const [a, b, c] = world.holders as [Signer, Signer, Signer];
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { holder: a.account });
      await moveTo(world, event, "Sealed", "Cancelled");
      await transfer(world, a, b, event, ticket);
      expect(await expectOk(world.ticketto.getCancellationHolder(ticket))).toBe(a.account);
      await transfer(world, b, c, event, ticket);
      await transfer(world, c, a, event, ticket);
      await transfer(world, a, b, event, ticket);
      expect((await ticketOf(world, ticket)).holder).toBe(b.account);
      expect(await expectOk(world.ticketto.getCancellationHolder(ticket))).toBe(a.account);
    },
  );

  test("REQ-EV-10: the fixed holder of a ticket never issued is not found", "M4", async (world) => {
    const event = await createEventWith(world);
    await moveTo(world, event, "Cancelled");
    const ticket = world.profile.ticketId(event, world.identifiers.zone(0), seat(world, 0));
    await expectError(world.ticketto.getCancellationHolder(ticket), "ERR-TicketNotFound");
  });
});
