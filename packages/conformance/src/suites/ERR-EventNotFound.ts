// ERR-EventNotFound: an operation or query against an event that does not exist
// (§10, amendment 0003).

import { expectError } from "../expect.js";
import { issue, seat } from "../steps.js";
import { suite } from "../suite.js";
import type { World } from "../world.js";

/** An event id nobody created: the organiser's derivation for an unused salt. */
function missingEvent(world: World) {
  return world.profile.eventId(world.organiser.account, world.identifiers.salt(9_999));
}

export default suite("ERR-EventNotFound", (test) => {
  test(
    "ERR-EventNotFound: a missing event is not found by query, issuance or zone changes",
    "M1",
    async (world) => {
      const event = missingEvent(world);
      await expectError(world.ticketto.getEvent(event), "ERR-EventNotFound");
      await expectError(
        issue(world, event, { placement: seat(world, 0) }).submission,
        "ERR-EventNotFound",
      );
      await expectError(
        world.ticketto.addZone(world.organiser, {
          event,
          zone: { id: world.identifiers.zone(0), kind: "Seated" },
        }),
        "ERR-EventNotFound",
      );
      await expectError(
        world.ticketto.removeZone(world.organiser, { event, zone: world.identifiers.zone(0) }),
        "ERR-EventNotFound",
      );
    },
  );

  test(
    "ERR-EventNotFound: a missing event is not found by status or capacity changes",
    "M4",
    async (world) => {
      const event = missingEvent(world);
      await expectError(
        world.ticketto.setEventStatus(world.organiser, { event, status: "Sealed" }),
        "ERR-EventNotFound",
      );
      await expectError(
        world.ticketto.setEventCapacity(world.organiser, { event, capacity: 1, proof: null }),
        "ERR-EventNotFound",
      );
    },
  );

  test(
    "ERR-EventNotFound: a missing event is not found by the gate's query",
    "M3",
    async (world) => {
      const event = missingEvent(world);
      const ticket = world.profile.ticketId(event, world.identifiers.zone(0), seat(world, 0));
      await expectError(world.ticketto.canAttend(event, ticket), "ERR-EventNotFound");
    },
  );
});
