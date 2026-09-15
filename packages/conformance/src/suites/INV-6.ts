// INV-6: an access pass MUST be consumable at most once (US-E1, AC-E1.4, REQ-AP-4).
// The concurrent case, AC-E3.2, is the concurrency variant's (T-004-08).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, passFor, present } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-6", (test) => {
  test(
    "INV-6: a consumed pass is not consumed again, however it is resubmitted",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { policy: { kind: "Unlimited", until: null } });
      const signed = await passFor(world, ticket, { id: 0 });
      const presentedAt = world.backend.clock.now();
      const receipt = await expectOk(present(world, signed, presentedAt));

      // Identical: the same signed pass and presentedAt — the original receipt.
      expect(await expectOk(present(world, signed, presentedAt))).toEqual(receipt);
      // Distinct: the same pass presented at another instant, or another pass under its id.
      await expectError(present(world, signed, presentedAt + 1_000), "ERR-PassReplayed");
      const sameId = await passFor(world, ticket, { id: 0, notBefore: signed.pass.notBefore - 1 });
      await expectError(present(world, sameId, presentedAt), "ERR-PassReplayed");

      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test("INV-6: distinct passes for one multi-use ticket are each admitted", "M3", async (world) => {
    const event = await createEventWith(world);
    const ticket = await issued(world, event, {
      policy: { kind: "Multiple", max: 3, until: null },
    });
    const passes = [
      await passFor(world, ticket, { id: 0 }),
      await passFor(world, ticket, { id: 1 }),
      await passFor(world, ticket, { id: 2 }),
    ];
    expect(new Set(passes.map(({ pass }) => pass.id)).size).toBe(3);
    for (const signed of passes) await expectOk(present(world, signed));
    expect(await attendancesOf(world, ticket)).toBe(3);
  });
});
