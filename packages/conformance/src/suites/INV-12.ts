// INV-12: a ticket with provenance Purchased MUST NOT carry cannot_resale or
// cannot_transfer, at issuance or ever after (REQ-TK-3, AC-B3.1).

import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, ticketOf, UNRESTRICTED } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-12", (test) => {
  test(
    "INV-12: a purchased ticket is never issued with a restriction; a granted one may be",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const restricted = [
        { cannotResale: true, cannotTransfer: false },
        { cannotResale: false, cannotTransfer: true },
        { cannotResale: true, cannotTransfer: true },
      ];
      for (const [index, restrictions] of restricted.entries()) {
        const refused = issue(world, event, { placement: seat(world, index), restrictions });
        await expectError(refused.submission, "ERR-RestrictionNotPermitted");
        await expectError(world.ticketto.getTicket(refused.id), "ERR-TicketNotFound");
      }
      const purchased = await issued(world, event, { placement: seat(world, 10) });
      expect(await ticketOf(world, purchased)).toMatchObject({
        provenance: "Purchased",
        restrictions: UNRESTRICTED,
      });
      const granted = await issued(world, event, {
        placement: seat(world, 11),
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
      });
      expect((await ticketOf(world, granted)).restrictions).toEqual({
        cannotResale: true,
        cannotTransfer: true,
      });
      expect((await eventOf(world, event)).issued).toBe(2);
    },
  );
});
