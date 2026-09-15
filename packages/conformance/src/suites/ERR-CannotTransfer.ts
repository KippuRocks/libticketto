// ERR-CannotTransfer: cannot_transfer is set (US-D1, AC-B3.3, REQ-TK-2, REQ-TK-4).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, issued, moveTo, seat, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-CannotTransfer", (test) => {
  test(
    "ERR-CannotTransfer: a ticket issued with cannot_transfer also carries cannot_resale",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: false, cannotTransfer: true },
      });
      expect((await ticketOf(world, ticket)).restrictions).toEqual({
        cannotResale: true,
        cannotTransfer: true,
      });
    },
  );

  test(
    "ERR-CannotTransfer: its holder cannot transfer a non-transferable ticket, and nothing changes",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
        holder: holder.account,
      });
      const before = await ticketOf(world, ticket);
      await expectError(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
        "ERR-CannotTransfer",
      );
      expect(await ticketOf(world, ticket)).toEqual(before);
    },
  );

  test(
    "ERR-CannotTransfer: a ticket restricted only against resale still transfers",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: false },
        holder: holder.account,
      });
      await expectOk(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
      );
      expect(await ticketOf(world, ticket)).toMatchObject({
        holder: receiver.account,
        restrictions: { cannotResale: true, cannotTransfer: false },
      });
    },
  );

  test(
    "ERR-CannotTransfer: once the organiser removes cannot_transfer, the holder transfers it",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
        holder: holder.account,
      });
      await expectOk(
        world.ticketto.removeRestriction(world.organiser, {
          event,
          ticket,
          restriction: "cannotTransfer",
        }),
      );
      await expectOk(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
      );
      expect((await ticketOf(world, ticket)).holder).toBe(receiver.account);
    },
  );

  test(
    "ERR-CannotTransfer: a purchased ticket always transfers, in an active, sealed or cancelled event",
    "M4",
    async (world) => {
      const [first, second, third] = world.holders as [Signer, Signer, Signer];
      for (const [index, statuses] of ([[], ["Sealed"], ["Cancelled"]] as const).entries()) {
        const event = await createEventWith(world, { salt: index });
        const ticket = await issued(world, event, {
          placement: seat(world, 0),
          holder: first.account,
        });
        await moveTo(world, event, ...statuses);
        await expectOk(
          world.ticketto.transferTicket(first, { event, ticket, receiver: second.account }),
        );
        await expectOk(
          world.ticketto.transferTicket(second, { event, ticket, receiver: third.account }),
        );
        expect((await ticketOf(world, ticket)).holder).toBe(third.account);
      }
    },
  );

  test(
    "ERR-CannotTransfer: a non-transferable ticket stays so after its event is cancelled",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const [holder, receiver] = world.holders as [Signer, Signer];
      const ticket = await issued(world, event, {
        provenance: "Granted",
        restrictions: { cannotResale: true, cannotTransfer: true },
        holder: holder.account,
      });
      await moveTo(world, event, "Cancelled");
      await expectError(
        world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
        "ERR-CannotTransfer",
      );
      expect(await expectOk(world.ticketto.getCancellationHolder(ticket))).toBe(holder.account);
    },
  );
});
