// ERR-InvalidPass: a pass not produced by the ticket's current holder (AC-E1.2,
// REQ-AP-1, REQ-AP-2).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, passFor, present, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-InvalidPass", (test) => {
  test(
    "ERR-InvalidPass: a pass signed by an account that does not hold the ticket fails",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, other] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, { holder: holder.account });

      // Signed by the other account, in its own name.
      await expectError(
        present(world, await passFor(world, ticket, { signer: other })),
        "ERR-InvalidPass",
      );
      // Signed by the other account, naming the holder.
      await expectError(
        present(
          world,
          await passFor(world, ticket, { id: 1, signer: other, holder: holder.account }),
        ),
        "ERR-InvalidPass",
      );
      // Signed by an account with no registered credential.
      await expectError(
        present(
          world,
          await passFor(world, ticket, { id: 2, signer: world.signers.stranger.signer }),
        ),
        "ERR-InvalidPass",
      );
      expect(await attendancesOf(world, ticket)).toBe(0);
    },
  );

  test(
    "ERR-InvalidPass: a holder's pass altered after signing fails, and is not usable for another ticket",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const holder = world.holders[0] as Signer;
      const ticket = await issued(world, event, {
        placement: seat(world, 0),
        holder: holder.account,
      });
      const second = await issued(world, event, {
        placement: seat(world, 1),
        holder: holder.account,
      });
      const signed = await passFor(world, ticket, { signer: holder });

      await expectError(
        present(world, { ...signed, pass: { ...signed.pass, ticket: second } }),
        "ERR-InvalidPass",
      );
      await expectError(
        present(world, { ...signed, pass: { ...signed.pass, notAfter: signed.pass.notAfter + 1 } }),
        "ERR-InvalidPass",
      );
      expect(await attendancesOf(world, second)).toBe(0);
      await expectOk(present(world, signed));
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-InvalidPass: after a transfer, the previous holder's pass fails and the new holder's admits",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, { holder: holder.account });
      const before = await passFor(world, ticket, { id: 0, signer: holder });
      await expectOk(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
      );
      await expectError(present(world, before), "ERR-InvalidPass");
      await expectOk(present(world, await passFor(world, ticket, { id: 1, signer: receiver })));
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );
});
