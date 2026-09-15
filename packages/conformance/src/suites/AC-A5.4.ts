// AC-A5.4: given status Cancelled, transfer remains permitted, so tickets can
// still be moved for accounting or collection purposes.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, moveTo, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("AC-A5.4", (test) => {
  test(
    "AC-A5.4: the holder of a cancelled event's ticket transfers it, and the receiver may transfer it on",
    "M4",
    async (world) => {
      const [a, b, c] = world.holders as [Signer, Signer, Signer];
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
        holder: a.account,
      });
      await moveTo(world, event, "Cancelled");
      await expectOk(world.ticketto.transferTicket(a, { event, ticket, receiver: b.account }));
      await expectOk(world.ticketto.transferTicket(b, { event, ticket, receiver: c.account }));
      expect(await ticketOf(world, ticket)).toMatchObject({
        holder: c.account,
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
      });
      expect(await attendancesOf(world, ticket)).toBe(0);
    },
  );
});
