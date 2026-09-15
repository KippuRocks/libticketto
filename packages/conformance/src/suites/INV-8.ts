// INV-8 (attendance): a ticket of a Cancelled event MUST NOT be used for attendance
// (AC-A5.2). Listing and buying are beyond V0.

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, moveTo, passFor, present } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-8", (test) => {
  test(
    "INV-8: a cancelled event's ticket is refused at the gate and by canAttend",
    "M4",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { policy: { kind: "Unlimited", until: null } });
      await expectOk(present(world, await passFor(world, ticket, { id: 0 })));
      await moveTo(world, event, "Cancelled");

      expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({
        admit: false,
        reason: "ERR-EventCancelled",
      });
      await expectError(
        present(world, await passFor(world, ticket, { id: 1 })),
        "ERR-EventCancelled",
      );
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test("INV-8: a pass produced before cancellation is refused after it", "M4", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event);
    const signed = await passFor(world, ticket, { id: 0 });
    await moveTo(world, event, "Sealed", "Cancelled");
    await expectError(present(world, signed), "ERR-EventCancelled");
    expect(await attendancesOf(world, ticket)).toBe(0);
  });

  test("INV-8: a sealed event's ticket still admits (AC-A4.2)", "M4", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event);
    await moveTo(world, event, "Sealed");
    expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({ admit: true });
    await expectOk(present(world, await passFor(world, ticket, { id: 0 })));
    expect(await attendancesOf(world, ticket)).toBe(1);
  });
});
