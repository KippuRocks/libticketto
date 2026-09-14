// INV-10: restrictions MUST NOT be added to a ticket after issuance; they may only
// be removed (REQ-TK-6, AC-B3.4).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, issue, issued, seat, ticketOf, UNRESTRICTED } from "../steps.js";
import { suite } from "../suite.js";

const BOTH = { cannotResale: true, cannotTransfer: true };

export default suite("INV-10", (test) => {
  test(
    "INV-10: issuing again at a ticket's identity cannot add restrictions to it",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        placement: seat(world, 0),
        provenance: "Granted",
        restrictions: UNRESTRICTED,
      });
      await expectError(
        issue(world, event, {
          placement: seat(world, 0),
          provenance: "Granted",
          restrictions: BOTH,
        }).submission,
        "ERR-TicketIdExists",
      );
      expect((await ticketOf(world, ticket)).restrictions).toEqual(UNRESTRICTED);
    },
  );

  test(
    "INV-10: removing a restriction clears only that flag, and nothing sets one again",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { provenance: "Granted", restrictions: BOTH });
      const remove = (restriction: "cannotResale" | "cannotTransfer") =>
        world.ticketto.removeRestriction(world.organiser, { event, ticket, restriction });

      await expectOk(remove("cannotTransfer"));
      expect((await ticketOf(world, ticket)).restrictions).toEqual({
        cannotResale: true,
        cannotTransfer: false,
      });
      await expectOk(remove("cannotResale"));
      expect((await ticketOf(world, ticket)).restrictions).toEqual(UNRESTRICTED);

      // Removing a flag already clear sets nothing, whether or not the ledger accepts it.
      await remove("cannotTransfer");
      await remove("cannotResale");
      expect((await ticketOf(world, ticket)).restrictions).toEqual(UNRESTRICTED);
    },
  );
});
