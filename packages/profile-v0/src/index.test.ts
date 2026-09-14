import { describe, expect, it } from "vitest";
import * as profile from "./index.js";

describe("@ticketto/profile-v0", () => {
  it("exports its package name", () => {
    expect(profile.packageName).toBe("@ticketto/profile-v0");
  });

  it("exports the command codec and the identity component codecs", () => {
    expect(typeof profile.encodeCommand).toBe("function");
    expect(typeof profile.decodeCommand).toBe("function");
    expect(typeof profile.codecs.placement.enc).toBe("function");
    expect(profile.FORMAT_VERSION).toBe(0);
  });
});
