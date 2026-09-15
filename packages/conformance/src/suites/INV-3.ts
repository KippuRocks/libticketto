// INV-3: attendances is monotonically non-decreasing; nothing resets, decrements
// or clears it (US-E3, AC-E3.1).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, moveTo, passFor, present } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-3", (test) => {
  test(
    "INV-3: each accepted pass adds exactly one attendance, and refused ones add none",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        policy: { kind: "Multiple", max: 2, until: null },
      });
      expect(await attendancesOf(world, ticket)).toBe(0);

      const first = await passFor(world, ticket, { id: 0 });
      const presentedAt = world.backend.clock.now();
      await expectOk(present(world, first, presentedAt));
      expect(await attendancesOf(world, ticket)).toBe(1);

      await expectOk(present(world, first, presentedAt));
      expect(await attendancesOf(world, ticket)).toBe(1);
      await expectError(present(world, first, presentedAt + 1), "ERR-PassReplayed");
      expect(await attendancesOf(world, ticket)).toBe(1);
      const stranger = await passFor(world, ticket, { id: 1, signer: world.holders[1] as Signer });
      await expectError(present(world, stranger), "ERR-InvalidPass");
      expect(await attendancesOf(world, ticket)).toBe(1);

      await expectOk(present(world, await passFor(world, ticket, { id: 2 })));
      expect(await attendancesOf(world, ticket)).toBe(2);
      await expectError(
        present(world, await passFor(world, ticket, { id: 3 })),
        "ERR-CannotAttend",
      );
      expect(await attendancesOf(world, ticket)).toBe(2);
    },
  );

  test("INV-3: attendances survive transfer and cancellation unchanged", "M4", async (world) => {
    const event = await createEventWith(world);
    const [holder, receiver] = world.holders as [Signer, Signer];
    const ticket = await issued(world, event, {
      policy: { kind: "Unlimited", until: null },
      holder: holder.account,
    });
    await expectOk(present(world, await passFor(world, ticket, { id: 0, signer: holder })));
    await expectOk(present(world, await passFor(world, ticket, { id: 1, signer: holder })));
    await expectOk(
      world.ticketto.transferTicket(holder, { event, ticket, receiver: receiver.account }),
    );
    expect(await attendancesOf(world, ticket)).toBe(2);
    await expectOk(present(world, await passFor(world, ticket, { id: 2, signer: receiver })));
    expect(await attendancesOf(world, ticket)).toBe(3);
    await moveTo(world, event, "Cancelled");
    expect(await attendancesOf(world, ticket)).toBe(3);
  });
});
