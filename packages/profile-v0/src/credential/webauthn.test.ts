/// <reference types="node" />
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Random } from "../../test/random.js";
import { webAuthnSuite } from "../../test/suites/webauthn.suite.js";
import { SimulatedWebAuthnAuthenticator } from "../testing/webauthn-authenticator.js";
import { p256PointFromSpki } from "./webauthn.js";

webAuthnSuite({ describe, it });

// The simulated authenticator's output, checked with Node's own crypto rather
// than the code under test: its public key is a real SubjectPublicKeyInfo and
// its assertions are real ES256 signatures.
describe("T-003-04 simulated authenticator, checked with node:crypto", () => {
  it("emits an SPKI public key and ES256 DER signatures over authData ‖ SHA-256(clientData)", () => {
    const random = new Random(0x40de);
    for (let run = 0; run < 20; run++) {
      const authenticator = new SimulatedWebAuthnAuthenticator({
        rpId: "kippu.example",
        secretKey: random.bytes(32),
        credentialId: random.bytes(32),
      });
      const key = createPublicKey({
        key: Buffer.from(authenticator.publicKeySpki),
        format: "der",
        type: "spki",
      });
      expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
      expect(p256PointFromSpki(authenticator.publicKeySpki)).not.toBeNull();

      const assertion = authenticator.assert(random.bytes(32), random.bytes(32), {
        highS: random.bool(),
      });
      const clientDataHash = createHash("sha256").update(assertion.client_data).digest();
      const signed = Buffer.concat([assertion.authenticator_data, clientDataHash]);
      expect(nodeVerify("sha256", signed, key, Buffer.from(assertion.signature))).toBe(true);
      expect(assertion.authenticator_data.subarray(0, 32)).toEqual(
        new Uint8Array(createHash("sha256").update("kippu.example").digest()),
      );
    }
  });
});
