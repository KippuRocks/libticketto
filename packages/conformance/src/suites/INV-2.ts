// INV-2: a ticket has exactly one holder at any time.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectOk } from "../expect.js";
import { createEventWith, issued, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-2", (test) => {
  test("INV-2: a ticket is held by exactly the account it was issued to", "M1", async (world) => {
    const event = await createEventWith(world);
    for (const [index, holder] of world.holders.entries()) {
      const ticket = await issued(world, event, {
        placement: seat(world, index),
        holder: holder.account,
      });
      expect((await ticketOf(world, ticket)).holder).toBe(holder.account);
    }
  });

  test("INV-2: after a transfer the receiver is the one holder", "M4", async (world) => {
    const event = await createEventWith(world);
    const [first, second, third] = world.holders as [Signer, Signer, Signer];
    const ticket = await issued(world, event, { holder: first.account });
    await expectOk(
      world.ticketto.transferTicket(first, { event, ticket, receiver: second.account }),
    );
    expect((await ticketOf(world, ticket)).holder).toBe(second.account);
    await expectOk(
      world.ticketto.transferTicket(second, { event, ticket, receiver: third.account }),
    );
    expect((await ticketOf(world, ticket)).holder).toBe(third.account);
  });
});
