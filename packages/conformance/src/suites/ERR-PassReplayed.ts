// ERR-PassReplayed: the pass has already been consumed (AC-E1.4, INV-6). Identity
// is the signed pass with its presentedAt: an identical resubmission, up to
// notAfter plus the maximum recording lag, returns the original receipt; any
// other submission under a consumed pass id is refused
// (features/008-ledger-rules/plan.md §5.2).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import {
  attendancesOf,
  createEventWith,
  gateParameter,
  issued,
  passFor,
  present,
} from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-PassReplayed", (test) => {
  test(
    "ERR-PassReplayed: the same pass presented again at another instant — a second gate — fails",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { policy: { kind: "Unlimited", until: null } });
      const signed = await passFor(world, ticket);
      const scannedAt = world.backend.clock.now();
      await expectOk(present(world, signed, scannedAt));
      world.backend.clock.advance(2_000);
      await expectError(present(world, signed, scannedAt + 2_000), "ERR-PassReplayed");
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-PassReplayed: an identical resubmission within notAfter plus the lag returns the original receipt",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, { policy: { kind: "Unlimited", until: null } });
      const signed = await passFor(world, ticket);
      const presentedAt = world.backend.clock.now();
      const receipt = await expectOk(present(world, signed, presentedAt));
      world.backend.clock.set(signed.pass.notAfter + gateParameter(world, "maxRecordingLag"));
      expect(await expectOk(present(world, signed, presentedAt))).toEqual(receipt);
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-PassReplayed: another pass signed under a consumed id fails, even on a ticket with allowance left",
    "M3",
    async (world) => {
      const event = await createEventWith(world);
      const ticket = await issued(world, event, {
        policy: { kind: "Multiple", max: 5, until: null },
      });
      const first = await passFor(world, ticket, { id: 7 });
      await expectOk(present(world, first));
      const reissued = await passFor(world, ticket, { id: 7, notAfter: first.pass.notAfter - 1 });
      await expectError(present(world, reissued), "ERR-PassReplayed");
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );
});
