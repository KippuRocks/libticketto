import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@ticketto/sdk", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/sdk");
  });
});
