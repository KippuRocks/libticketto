// REQ-CM-1: every command is idempotent-safe — a replayed submission is rejected
// or a no-op, never a second state change. An identical replay within its expiry
// returns the original receipt (AD-15).

import type { AddZone, CreateEvent, IssueTicket, Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectOk } from "../expect.js";
import {
  createEventWith,
  envelope,
  eventOf,
  seat,
  sign,
  standardZones,
  submitSigned,
  ticketOf,
  UNRESTRICTED,
} from "../steps.js";
import { suite } from "../suite.js";

export default suite("REQ-CM-1", (test) => {
  test(
    "REQ-CM-1: an identical replay of a creation returns the original receipt and changes nothing",
    "M1",
    async (world) => {
      const salt = world.identifiers.salt(0);
      const command: CreateEvent = {
        kind: "createEvent",
        ...envelope(world),
        event: world.profile.eventId(world.organiser.account, salt),
        salt,
        zones: standardZones(world),
        capacity: 10,
        metadata: null,
      };
      const signed = await sign(world, world.organiser, command);
      const receipt = await expectOk(submitSigned(world, signed));
      const before = await eventOf(world, command.event);

      expect(await expectOk(submitSigned(world, signed))).toEqual(receipt);
      expect(await expectOk(submitSigned(world, signed))).toEqual(receipt);
      expect(await eventOf(world, command.event)).toEqual(before);
    },
  );

  test("REQ-CM-1: an identical replay of an issuance issues nothing more", "M1", async (world) => {
    const event = await createEventWith(world, { capacity: 10 });
    const zone = world.identifiers.zone(0);
    const command: IssueTicket = {
      kind: "issueTicket",
      ...envelope(world),
      event,
      ticket: world.profile.ticketId(event, zone, seat(world, 0)),
      zone,
      placement: seat(world, 0),
      class: world.identifiers.class(0),
      provenance: "Purchased",
      policy: { kind: "Single" },
      restrictions: UNRESTRICTED,
      holder: (world.holders[0] as Signer).account,
      metadata: null,
    };
    const signed = await sign(world, world.organiser, command);
    const receipt = await expectOk(submitSigned(world, signed));
    const ticket = await ticketOf(world, command.ticket);

    expect(await expectOk(submitSigned(world, signed))).toEqual(receipt);
    expect((await eventOf(world, event)).issued).toBe(1);
    expect(await ticketOf(world, command.ticket)).toEqual(ticket);
  });

  test(
    "REQ-CM-1: a replay later in the command's lifetime is still a no-op",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const command: AddZone = {
        kind: "addZone",
        ...envelope(world),
        event,
        zone: { id: world.identifiers.zone(5), kind: "Unseated" },
      };
      const signed = await sign(world, world.organiser, command);
      const receipt = await expectOk(submitSigned(world, signed));
      const before = await eventOf(world, event);
      world.backend.clock.set(command.expiresAt);
      expect(await expectOk(submitSigned(world, signed))).toEqual(receipt);
      expect(await eventOf(world, event)).toEqual(before);
    },
  );
});
