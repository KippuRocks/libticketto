// ERR-PassExpired: the pass validity window has closed (AC-E1.3, REQ-AP-3). Its
// presentedAt must fall within [notBefore, notAfter], no more than the maximum
// clock skew ahead of the ledger's clock, its window no longer than the maximum
// pass window, and the ledger must record it no later than notAfter plus the
// maximum recording lag (features/008-ledger-rules/plan.md
// §5.2).

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
import type { World } from "../world.js";

async function unlimitedTicket(world: World) {
  const event = await createEventWith(world);
  return issued(world, event, { policy: { kind: "Unlimited", until: null } });
}

export default suite("ERR-PassExpired", (test) => {
  test(
    "ERR-PassExpired: presented before notBefore or after notAfter fails; both edges admit",
    "M3",
    async (world) => {
      const ticket = await unlimitedTicket(world);
      const now = world.backend.clock.now();
      const window = { notBefore: now - 30_000, notAfter: now }; // presented in the past, recorded now

      await expectError(
        present(world, await passFor(world, ticket, { id: 0, ...window }), now - 30_001),
        "ERR-PassExpired",
      );
      await expectError(
        present(world, await passFor(world, ticket, { id: 1, ...window }), now + 1),
        "ERR-PassExpired",
      );
      expect(await attendancesOf(world, ticket)).toBe(0);

      await expectOk(
        present(world, await passFor(world, ticket, { id: 2, ...window }), now - 30_000),
      );
      await expectOk(present(world, await passFor(world, ticket, { id: 3, ...window }), now));
      expect(await attendancesOf(world, ticket)).toBe(2);
    },
  );

  test(
    "ERR-PassExpired: a pass recorded after notAfter plus the maximum recording lag fails; at it, it admits",
    "M3",
    async (world) => {
      const ticket = await unlimitedTicket(world);
      const late = await passFor(world, ticket, { id: 0 });
      const onTime = await passFor(world, ticket, { id: 1 });
      const presentedAt = late.pass.notAfter;
      const deadline = late.pass.notAfter + gateParameter(world, "maxRecordingLag");

      world.backend.clock.set(deadline);
      await expectOk(present(world, onTime, presentedAt));
      world.backend.clock.set(deadline + 1);
      await expectError(present(world, late, presentedAt), "ERR-PassExpired");
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-PassExpired: presentedAt more than the maximum clock skew ahead of the ledger fails; at the skew, it admits",
    "M3",
    async (world) => {
      const ticket = await unlimitedTicket(world);
      const now = world.backend.clock.now();
      const skew = gateParameter(world, "maxClockSkew");
      const window = { notBefore: now, notAfter: now + skew + 60_000 };

      await expectError(
        present(world, await passFor(world, ticket, { id: 0, ...window }), now + skew + 1),
        "ERR-PassExpired",
      );
      await expectOk(
        present(world, await passFor(world, ticket, { id: 1, ...window }), now + skew),
      );
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-PassExpired: an identical resubmission after notAfter plus the lag is refused, not a receipt",
    "M3",
    async (world) => {
      const ticket = await unlimitedTicket(world);
      const signed = await passFor(world, ticket, { id: 0 });
      const presentedAt = world.backend.clock.now();
      await expectOk(present(world, signed, presentedAt));
      world.backend.clock.set(signed.pass.notAfter + gateParameter(world, "maxRecordingLag") + 1);
      await expectError(present(world, signed, presentedAt), "ERR-PassExpired");
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );

  test(
    "ERR-PassExpired: a pass whose window is longer than the maximum pass window fails; at the maximum, it admits",
    "M3",
    async (world) => {
      const ticket = await unlimitedTicket(world);
      const now = world.backend.clock.now();
      const longest = gateParameter(world, "maxPassWindow");

      await expectError(
        present(
          world,
          await passFor(world, ticket, { id: 0, notBefore: now - longest - 1, notAfter: now }),
          now,
        ),
        "ERR-PassExpired",
      );
      expect(await attendancesOf(world, ticket)).toBe(0);
      await expectOk(
        present(
          world,
          await passFor(world, ticket, { id: 1, notBefore: now - longest, notAfter: now }),
          now,
        ),
      );
      expect(await attendancesOf(world, ticket)).toBe(1);
    },
  );
});
