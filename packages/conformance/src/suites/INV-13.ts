// INV-13: a TicketId is determined solely by event, zone and placement, and is
// unique; within a seated zone at most one ticket exists per position (REQ-ID-1,
// REQ-ID-2, AC-B5.1, AC-B5.3).

import type { Signer } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, standing, ticketOf } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-13", (test) => {
  test(
    "INV-13: a ticket's id is the profile's derivation from its event, zone and placement",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const zone = world.identifiers.zone(0);
      const ticket = await issued(world, event, { zone, placement: seat(world, 4) });
      expect(ticket).toBe(world.profile.ticketId(event, zone, seat(world, 4)));
      expect((await ticketOf(world, ticket)).id).toBe(ticket);
    },
  );

  test(
    "INV-13: a second ticket for the same position is rejected, whatever else differs",
    "M1",
    async (world) => {
      const event = await createEventWith(world);
      const first = await issued(world, event, { placement: seat(world, 0) });
      const before = await ticketOf(world, first);
      const second = issue(world, event, {
        placement: seat(world, 0),
        class: 3,
        provenance: "Granted",
        policy: { kind: "Unlimited", until: null },
        restrictions: { cannotResale: true, cannotTransfer: false },
        holder: (world.holders[1] as Signer).account,
      });
      expect(second.id).toBe(first);
      await expectError(second.submission, "ERR-TicketIdExists");
      expect(await ticketOf(world, first)).toEqual(before);
      expect((await eventOf(world, event)).issued).toBe(1);
    },
  );

  test(
    "INV-13: other positions, zones, discriminators and events are other tickets",
    "M1",
    async (world) => {
      const event = await createEventWith(world, {
        zones: [
          { id: world.identifiers.zone(0), kind: "Seated" },
          { id: world.identifiers.zone(1), kind: "Unseated" },
          { id: world.identifiers.zone(2), kind: "Seated" },
        ],
      });
      const other = await createEventWith(world, { salt: 1 });
      const tickets = [
        await issued(world, event, { placement: seat(world, 0) }),
        await issued(world, event, { placement: seat(world, 1) }),
        await issued(world, event, { zone: world.identifiers.zone(2), placement: seat(world, 0) }),
        await issued(world, event, {
          zone: world.identifiers.zone(1),
          placement: standing(world, 0),
        }),
        await issued(world, event, {
          zone: world.identifiers.zone(1),
          placement: standing(world, 1),
        }),
        await issued(world, other, { placement: seat(world, 0) }),
      ];
      expect(new Set(tickets).size).toBe(tickets.length);
      expect((await eventOf(world, event)).issued).toBe(5);
    },
  );
});
