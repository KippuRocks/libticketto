// REQ-SDK-6: a backend declares, per invariant of §9, whether it enforces or
// attests it.

import { expect } from "vitest";
import { assuranceProblems } from "../assurance.js";
import { suite } from "../suite.js";

export default suite("REQ-SDK-6", (test) => {
  test("REQ-SDK-6: the assurance declaration covers every invariant of §9, and nothing else", async (world) => {
    expect(assuranceProblems(world.backend.assurance)).toEqual([]);
    expect(world.ticketto.assurance()).toEqual(world.backend.assurance);
  });
});
