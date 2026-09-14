// ERR-InvalidTransition: a status change not permitted by REQ-EV-11 (AC-A5.6,
// AC-A5.8). Permitted: Active → Sealed, Active | Sealed → Finished, Active | Sealed
// → Cancelled. Changes out of Finished fail with ERR-EventFinished first (INV-16).

import type { EventStatus } from "@ticketto/sdk";
import { expect } from "vitest";
import { expectError } from "../expect.js";
import { createEventWith, eventOf, moveTo } from "../steps.js";
import { suite } from "../suite.js";

const REFUSED: readonly [path: readonly EventStatus[], to: EventStatus][] = [
  [[], "Active"],
  [["Sealed"], "Active"],
  [["Sealed"], "Sealed"],
  [["Cancelled"], "Active"],
  [["Cancelled"], "Sealed"],
  [["Cancelled"], "Cancelled"],
  [["Cancelled"], "Finished"],
];

export default suite("ERR-InvalidTransition", (test) => {
  test(
    "ERR-InvalidTransition: every status change REQ-EV-11 does not permit fails and changes nothing",
    "M4",
    async (world) => {
      for (const [index, [path, to]] of REFUSED.entries()) {
        const event = await createEventWith(world, { salt: index });
        await moveTo(world, event, ...path);
        const before = await eventOf(world, event);
        await expectError(
          world.ticketto.setEventStatus(world.organiser, { event, status: to }),
          "ERR-InvalidTransition",
        );
        expect(await eventOf(world, event), `${[...path, to].join(" → ")}`).toEqual(before);
      }
    },
  );

  test("ERR-InvalidTransition: every permitted transition succeeds", "M4", async (world) => {
    const paths: readonly (readonly EventStatus[])[] = [
      ["Sealed"],
      ["Finished"],
      ["Cancelled"],
      ["Sealed", "Finished"],
      ["Sealed", "Cancelled"],
    ];
    for (const [index, path] of paths.entries()) {
      const event = await createEventWith(world, { salt: index });
      await moveTo(world, event, ...path);
      expect((await eventOf(world, event)).status).toBe(path.at(-1));
    }
  });
});
