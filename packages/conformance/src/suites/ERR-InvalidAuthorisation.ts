// ERR-InvalidAuthorisation: a command whose authorisation does not verify, or does
// not come from a credential registered to the signing account (REQ-CP-6).

import type { CreateEvent } from "@ticketto/sdk";
import { expectError } from "../expect.js";
import { createEventWith, envelope, sign, standardZones, submitSigned } from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-InvalidAuthorisation", (test) => {
  test(
    "ERR-InvalidAuthorisation: a credential registered to no account authorises nothing",
    "M1",
    async (world) => {
      const stranger = world.signers.stranger.signer;
      const { id, submission } = world.ticketto.createEvent(stranger, {
        salt: world.identifiers.salt(0),
        zones: standardZones(world),
        capacity: null,
        metadata: null,
      });
      await expectError(submission, "ERR-InvalidAuthorisation");
      await expectError(world.ticketto.getEvent(id), "ERR-EventNotFound");
    },
  );

  test(
    "ERR-InvalidAuthorisation: an authorisation over one command does not authorise another",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const signed = await sign(world, world.organiser, {
        kind: "addZone",
        ...envelope(world),
        event,
        zone: { id: world.identifiers.zone(5), kind: "Seated" },
      });
      await expectError(
        submitSigned(world, {
          ...signed,
          command: {
            ...signed.command,
            zone: { id: world.identifiers.zone(6), kind: "Seated" },
          } as typeof signed.command,
        }),
        "ERR-InvalidAuthorisation",
      );
    },
  );

  test(
    "ERR-InvalidAuthorisation: another account's authorisation, over other bytes, does not authorise a command",
    "M1",
    async (world) => {
      const salt = world.identifiers.salt(0);
      const command: CreateEvent = {
        kind: "createEvent",
        ...envelope(world),
        event: world.profile.eventId(world.organiser.account, salt),
        salt,
        zones: standardZones(world),
        capacity: null,
        metadata: null,
      };
      const other = world.holders[0];
      if (other === undefined) throw new Error("fixtures need a holder");
      const byHolder = await sign(world, other, { ...command, capacity: 1 });
      await expectError(
        submitSigned(world, { command, authorisation: byHolder.authorisation }),
        "ERR-InvalidAuthorisation",
      );
      await expectError(world.ticketto.getEvent(command.event), "ERR-EventNotFound");
    },
  );
});
