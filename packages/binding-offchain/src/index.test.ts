import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@ticketto/binding-offchain", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/binding-offchain");
  });
});
