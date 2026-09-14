import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@ticketto/backend-memory", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/backend-memory");
  });
});
