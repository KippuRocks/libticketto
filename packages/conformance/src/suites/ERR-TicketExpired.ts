// ERR-TicketExpired: the policy's until has passed (AC-B1.3, AC-B1.4). A submitted
// pass is judged at its presentedAt; canAttend at the ledger's clock
// (features/008-ledger-rules/plan.md §5.2, SPEC.md §7.E).

import type { AttendancePolicy } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { attendancesOf, createEventWith, issued, passFor, present, seat } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-TicketExpired", (test) => {
  test(
    "ERR-TicketExpired: a pass presented after the policy's until fails, for Multiple and Unlimited",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const now = world.backend.clock.now();
      const until = now + 1_000;
      const policies: AttendancePolicy[] = [
        { kind: "Multiple", max: 5, until },
        { kind: "Unlimited", until },
      ];
      for (const [index, policy] of policies.entries()) {
        const ticket = await issued(world, event, { placement: seat(world, index), policy });
        const window = { notBefore: now, notAfter: until + 5_000 };
        await expectOk(
          present(world, await passFor(world, ticket, { id: 2 * index, ...window }), until),
        );
        world.backend.clock.set(Math.max(world.backend.clock.now(), until + 1));
        await expectError(
          present(world, await passFor(world, ticket, { id: 2 * index + 1, ...window }), until + 1),
          "ERR-TicketExpired",
        );
        expect(await attendancesOf(world, ticket)).toBe(1);
      }
    },
  );

  test(
    "ERR-TicketExpired: canAttend admits at until and refuses after it, by the ledger's clock",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const until = world.backend.clock.now() + 1_000;
      const ticket = await issued(world, event, { policy: { kind: "Unlimited", until } });
      world.backend.clock.set(until);
      expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({ admit: true });
      world.backend.clock.set(until + 1);
      expect(await expectOk(world.ticketto.canAttend(event, ticket))).toEqual({
        admit: false,
        reason: "ERR-TicketExpired",
      });
    },
  );

  test(
    "ERR-TicketExpired: a pass presented before until and recorded after it admits",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const now = world.backend.clock.now();
      const until = now + 1_000;
      const ticket = await issued(world, event, { policy: { kind: "Multiple", max: 2, until } });
      const signed = await passFor(world, ticket, { notBefore: now, notAfter: until + 5_000 });
      world.backend.clock.set(until + 2_000);
      await expectOk(present(world, signed, until));
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );
});
