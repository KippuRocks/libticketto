// ERR-CannotAttend: the policy's allowance is exhausted (AC-E3.3).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, passFor, present, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-CannotAttend", (test) => {
  test(
    "ERR-CannotAttend: a fresh pass for an exhausted ticket fails and changes nothing",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        policy: { kind: "Multiple", max: 2, until: null },
      });
      await expectOk(present(world, await passFor(world, ticket, { id: 0 })));
      await expectOk(present(world, await passFor(world, ticket, { id: 1 })));
      const before = await ticketOf(world, ticket);
      await expectError(
        present(world, await passFor(world, ticket, { id: 2 })),
        "ERR-CannotAttend",
      );
      expect(await ticketOf(world, ticket)).toEqual(before);
      expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({
        admit: false,
        reason: "ERR-CannotAttend",
      });
    },
  );

  test("ERR-CannotAttend: a refused pass is not consumed", "M3", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event, { policy: { kind: "Single" } });
    await expectOk(present(world, await passFor(world, ticket, { id: 0 })));
    const refused = await passFor(world, ticket, { id: 1 });
    const presentedAt = world.backend.clock.now();
    await expectError(present(world, refused, presentedAt), "ERR-CannotAttend");
    await expectError(present(world, refused, presentedAt), "ERR-CannotAttend");
    expect(await attendancesOf(world, ticket)).toBe(1);
  });
});
