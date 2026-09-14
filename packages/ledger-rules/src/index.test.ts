import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@ticketto/ledger-rules", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/ledger-rules");
  });
});
