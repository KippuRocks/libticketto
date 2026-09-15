// INV-5: attendances MUST NOT exceed the allowance implied by the policy (US-B1,
// AC-B1.1–AC-B1.3, AC-E3.3).

import type { AttendancePolicy } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, passFor, present, seat } from "../steps.js";
import { suite } from "../suite.js";
import type { World } from "../world.js";

async function admitUntilRefused(
  world: World,
  policy: AttendancePolicy,
  index: number,
  tries: number,
) {
  const event = await createEventWith(world, { salt: index });
  const ticket = await issued(world, event, { placement: seat(world, 0), policy });
  let admitted = 0;
  for (let id = 0; id < tries; id++) {
    const result = await present(world, await passFor(world, ticket, { id }));
    if (!result.ok) {
      expect(result.error.code).toBe("ERR-CannotAttend");
      break;
    }
    admitted += 1;
  }
  expect(await attendancesOf(world, ticket)).toBe(admitted);
  return { event, ticket, admitted };
}

export default suite("INV-5", (test) => {
  test("INV-5: a Single ticket admits exactly once", "M3", async (world) => {
    const { admitted } = await admitUntilRefused(world, { kind: "Single" }, 0, 3);
    expect(admitted).toBe(1);
  });

  test("INV-5: a Multiple ticket admits at most its max", "M3", async (world) => {
    const { admitted } = await admitUntilRefused(
      world,
      { kind: "Multiple", max: 3, until: null },
      0,
      5,
    );
    expect(admitted).toBe(3);
  });

  test("INV-5: a Multiple ticket with max 0 admits nobody", "M3", async (world) => {
    const { admitted } = await admitUntilRefused(
      world,
      { kind: "Multiple", max: 0, until: null },
      0,
      2,
    );
    expect(admitted).toBe(0);
  });

  test(
    "INV-5: an Unlimited ticket admits every distinct pass before its until",
    "M3",
    async (world) => {
      const until = world.backend.clock.now() + 3_600_000;
      const { admitted } = await admitUntilRefused(world, { kind: "Unlimited", until }, 0, 8);
      expect(admitted).toBe(8);
    },
  );

  test("INV-5: canAttend refuses an exhausted ticket without changing it", "M3", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event, { policy: { kind: "Single" } });
    expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({ admit: true });
    await expectOk(present(world, await passFor(world, ticket, { id: 0 })));
    expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({
      admit: false,
      reason: "ERR-CannotAttend",
    });
    await expectError(present(world, await passFor(world, ticket, { id: 1 })), "ERR-CannotAttend");
    expect(await attendancesOf(world, ticket)).toBe(1);
  });
});
