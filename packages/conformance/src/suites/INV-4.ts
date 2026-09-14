// INV-4: if max_capacity is present, issued tickets MUST NOT exceed it
// (US-A1, AC-A1.2, AC-A1.3, US-B5 AC-B5.3).

import { expect } from "vitest";
import { expectError, expectOk } from "../expect.js";
import { createEventWith, eventOf, issue, issued, seat, standing } from "../steps.js";
import { suite } from "../suite.js";

export default suite("INV-4", (test) => {
  test(
    "INV-4: issuance stops at capacity, across zones, classes and provenances",
    "M1",
    async (world) => {
      const event = await createEventWith(world, { capacity: 3 });
      await issued(world, event, { placement: seat(world, 0) });
      await issued(world, event, {
        zone: world.identifiers.zone(1),
        placement: standing(world, 0),
        class: 1,
        provenance: "Granted",
      });
      await issued(world, event, { placement: seat(world, 1), class: 2 });
      await expectError(
        issue(world, event, { zone: world.identifiers.zone(1), placement: standing(world, 1) })
          .submission,
        "ERR-CapacityExceeded",
      );
      expect((await eventOf(world, event)).issued).toBe(3);
    },
  );

  test("INV-4: without a capacity, issuance is unbounded", "M1", async (world) => {
    const event = await createEventWith(world, { capacity: null });
    expect((await eventOf(world, event)).maxCapacity).toBeNull();
    for (let i = 0; i < 25; i++) {
      await issued(world, event, {
        zone: world.identifiers.zone(1),
        placement: standing(world, i),
      });
    }
    expect((await eventOf(world, event)).issued).toBe(25);
  });

  test("INV-4: a capacity lowered to issued admits no further ticket", "M4", async (world) => {
    const event = await createEventWith(world, { capacity: 5 });
    await issued(world, event, { placement: seat(world, 0) });
    await issued(world, event, { placement: seat(world, 1) });
    await expectOk(
      world.ticketto.setEventCapacity(world.organiser, { event, capacity: 2, proof: null }),
    );
    await expectError(
      issue(world, event, { placement: seat(world, 2) }).submission,
      "ERR-CapacityExceeded",
    );
    expect(await eventOf(world, event)).toMatchObject({ maxCapacity: 2, issued: 2 });
  });
});
