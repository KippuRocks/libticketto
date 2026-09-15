// AC-A5.5 (ledger side): the holder set fixed at cancellation (REQ-EV-10) is
// recorded on the ledger, whatever transfers followed. Who Kippu refunds — the
// original purchaser in V0 (DEF-12) — is platform behaviour, verified in F-022.

import type { Signer, TicketId } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectOk } from "../expect.js";
import { createEventWith, issued, moveTo, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("AC-A5.5", (test) => {
  test(
    "AC-A5.5: every ticket of a cancelled event has its holder at cancellation recorded, whatever transfers followed",
    "M4",
    async (world) => {
      const [a, b, c] = world.holders as [Signer, Signer, Signer];
      const event = await createEventWith(world);
      const holders = [a, b, c, a];
      const tickets: TicketId[] = [];
      for (const [index, holder] of holders.entries()) {
        tickets.push(
          await issued(world, event, { placement: seat(world, index), holder: holder.account }),
        );
      }
      await moveTo(world, event, "Cancelled");
      // Everything moves to c, and on to a.
      for (const [index, ticket] of tickets.entries()) {
        const from = holders[index] as Signer;
        if (from !== c) {
          await expectOk(
            world.ticketto.transferTicket(from, { event, ticket, receiver: c.account }),
          );
        }
        await expectOk(world.ticketto.transferTicket(c, { event, ticket, receiver: a.account }));
      }
      for (const [index, ticket] of tickets.entries()) {
        expect(
          await expectOk(world.ticketto.getCancellationHolder(ticket)),
          `ticket ${index}`,
        ).toBe((holders[index] as Signer).account);
      }
    },
  );
});
