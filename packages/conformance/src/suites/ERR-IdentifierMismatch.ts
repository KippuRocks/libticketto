// ERR-IdentifierMismatch: a command whose stated EventId or TicketId is not the
// profile's derivation of its stated components (REQ-EV-9, REQ-ID-1, amendment
// 0003).

import type { CreateEvent, IssueTicket, Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import {
  createEventWith,
  envelope,
  eventOf,
  seat,
  sign,
  standardZones,
  submitSigned,
  UNRESTRICTED,
} from "../steps.js";
import { suite } from "../suite.js";

export default suite("ERR-IdentifierMismatch", (test) => {
  test(
    "ERR-IdentifierMismatch: an event id not derived from its signer and salt fails, and no event exists",
    "M1",
    async (world) => {
      const salt = world.identifiers.salt(0);
      const stated = world.profile.eventId((world.holders[0] as Signer).account, salt);
      const command: CreateEvent = {
        kind: "createEvent",
        ...envelope(world),
        event: stated,
        salt,
        zones: standardZones(world),
        capacity: null,
        metadata: null,
      };
      await expectError(
        submitSigned(world, await sign(world, world.organiser, command)),
        "ERR-IdentifierMismatch",
      );
      await expectError(world.ticketto.getEvent(stated), "ERR-EventNotFound");
      await expectError(
        world.ticketto.getEvent(world.profile.eventId(world.organiser.account, salt)),
        "ERR-EventNotFound",
      );
    },
  );

  test(
    "ERR-IdentifierMismatch: a ticket id not derived from its event, zone and placement fails, and no ticket exists",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const zone = world.identifiers.zone(0);
      const stated = world.profile.ticketId(event, zone, seat(world, 1));
      const command: IssueTicket = {
        kind: "issueTicket",
        ...envelope(world),
        event,
        ticket: stated,
        zone,
        placement: seat(world, 0),
        class: world.identifiers.class(0),
        provenance: "Purchased",
        policy: { kind: "Single" },
        restrictions: UNRESTRICTED,
        holder: (world.holders[0] as Signer).account,
        metadata: null,
      };
      await expectError(
        submitSigned(world, await sign(world, world.organiser, command)),
        "ERR-IdentifierMismatch",
      );
      await expectError(world.ticketto.getTicket(stated), "ERR-TicketNotFound");
      await expectError(
        world.ticketto.getTicket(world.profile.ticketId(event, zone, seat(world, 0))),
        "ERR-TicketNotFound",
      );
      expect((await eventOf(world, event)).issued).toBe(0);
    },
  );
});
