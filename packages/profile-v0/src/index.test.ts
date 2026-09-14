import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@ticketto/profile-v0", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/profile-v0");
  });
});
