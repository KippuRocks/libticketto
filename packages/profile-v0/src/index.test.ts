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

  it("exports p256 credential construction and verification", () => {
    expect(typeof profile.p256AuthorisationDigest).toBe("function");
    expect(typeof profile.encodeRegistration).toBe("function");
    expect(typeof profile.verify).toBe("function");
    expect(profile.CREDENTIAL_KIND_INDEX.p256).toBe(1);
  });

  it("exports pass-webauthn codecs and verification", () => {
    expect(typeof profile.attestationCodec.enc).toBe("function");
    expect(typeof profile.assertionCodec.enc).toBe("function");
    expect(typeof profile.checkWebAuthnAssertion).toBe("function");
    expect(profile.CREDENTIAL_KIND_INDEX.passWebAuthn).toBe(0);
    expect(profile.KREIVO_AUTHORITY_ID).toHaveLength(32);
  });

  it("does not export the simulated authenticator from the main entry point", () => {
    expect(Object.keys(profile).some((name) => /simulated/i.test(name))).toBe(false);
  });

  it("exports the access pass codec, production and verification", () => {
    expect(profile.PASS_LENGTH).toBe(97);
    expect(profile.DEFAULT_PASS_WINDOW).toBe(60_000);
    expect(typeof profile.producePass).toBe("function");
    expect(typeof profile.verifyPass).toBe("function");
  });

  it("exports identifier derivation", () => {
    expect(typeof profile.eventId).toBe("function");
    expect(typeof profile.ticketId).toBe("function");
    expect(typeof profile.holderAccountId).toBe("function");
    expect(typeof profile.p256AccountId).toBe("function");
    expect(typeof profile.deviceId).toBe("function");
  });
});
