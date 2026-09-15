// REQ-CP-6: an account may have more than one registered credential, any of which
// may authorise for it. The first registration creates the account; each further
// one must be authorised by a credential already registered to that account.

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, standardZones } from "../steps.js";
import { suite } from "../suite.js";
import { register } from "../world.js";

export default suite("REQ-CP-6", (test) => {
  test(
    "REQ-CP-6: the first registration creates an account, whose credential then authorises",
    "M1",
    async (world) => {
      const stranger = world.signers.stranger;
      const attempt = () =>
        world.ticketto.createEvent(stranger.signer, {
          salt: world.identifiers.salt(0),
          zones: standardZones(world),
          capacity: null,
          metadata: null,
        });
      await expectError(attempt().submission, "ERR-InvalidAuthorisation");
      await expectOk(register(world.ticketto, stranger));
      const { id, submission } = attempt();
      await expectOk(submission);
      expect((await eventOf(world, id)).owner).toBe(stranger.signer.account);
    },
  );

  test(
    "REQ-CP-6: a second device registers with an existing credential's authorisation, and then authorises for the account",
    "M1",
    async (world) => {
      const holder = world.holders[0] as Signer;
      const device = world.signers.secondDevice;
      expect(device.signer.account).toBe(holder.account);
      await expectOk(
        world.ticketto.registerCredential(holder, {
          account: holder.account,
          registration: device.registration,
        }),
      );
      const event = await createEventWith(world, { signer: device.signer, salt: 1 });
      expect((await eventOf(world, event)).owner).toBe(holder.account);
      // The first device still authorises too.
      const other = await createEventWith(world, { signer: holder, salt: 2 });
      expect((await eventOf(world, other)).owner).toBe(holder.account);
    },
  );

  test(
    "REQ-CP-6: a further credential cannot register itself to an existing account",
    "M1",
    async (world) => {
      const device = world.signers.secondDevice;
      await expectError(register(world.ticketto, device), "ERR-InvalidAuthorisation");
      await expectError(
        world.ticketto.createEvent(device.signer, {
          salt: world.identifiers.salt(1),
          zones: [],
          capacity: null,
          metadata: null,
        }).submission,
        "ERR-InvalidAuthorisation",
      );
    },
  );

  test(
    "REQ-CP-6: another account's credential cannot register a device to an account",
    "M1",
    async (world) => {
      const intruder = world.holders[1] as Signer;
      const device = world.signers.secondDevice;
      await expectError(
        world.ticketto.registerCredential(intruder, {
          account: device.signer.account,
          registration: device.registration,
        }),
        "ERR-InvalidAuthorisation",
      );
      await expectError(
        world.ticketto.createEvent(device.signer, {
          salt: world.identifiers.salt(1),
          zones: [],
          capacity: null,
          metadata: null,
        }).submission,
        "ERR-InvalidAuthorisation",
      );
    },
  );
});
