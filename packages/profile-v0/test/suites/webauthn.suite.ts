// T-003-04 — `pass-webauthn` attestation and assertion codecs, and assertion
// verification against a registered device (REQ-SP-4, REQ-CP-6, REQ-SDK-4).

import type { Authorisation, Registration } from "@ticketto/sdk";
import { fromHex, toHex } from "../../src/bytes.js";
import { decodeExact } from "../../src/codec/scale.js";
import {
  accountOf,
  decodeAuthorisation,
  decodeRegistration,
  encodeAuthorisation,
  encodeRegistration,
  registrationAccount,
  verify,
} from "../../src/credential/credential.js";
import {
  assertionCodec,
  attestationCodec,
  checkWebAuthnAssertion,
  KREIVO_AUTHORITY_ID,
  webAuthnChallenge,
} from "../../src/credential/webauthn.js";
import { hashedUserId, holderAccountId } from "../../src/derive.js";
import {
  type CeremonyOverrides,
  SimulatedWebAuthnAuthenticator,
} from "../../src/testing/webauthn-authenticator.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { p256Key } from "../keys.js";
import { Random } from "../random.js";

const RP_ID = "kippu.example";
const CONFIG = { rpId: RP_ID };

function device(random: Random, rpId = RP_ID): SimulatedWebAuthnAuthenticator {
  return new SimulatedWebAuthnAuthenticator({
    rpId,
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(16 + random.below(48)),
  });
}

function register(userId: string, authenticator: SimulatedWebAuthnAuthenticator): Registration {
  const hashed = hashedUserId(userId);
  return encodeRegistration({
    kind: "passWebAuthn",
    hashedUserId: hashed,
    attestation: authenticator.attest(fromHex(holderAccountId(userId))),
  });
}

function authorise(
  userId: string,
  authenticator: SimulatedWebAuthnAuthenticator,
  payload: Uint8Array,
  overrides?: CeremonyOverrides,
): Authorisation {
  return encodeAuthorisation({
    kind: "passWebAuthn",
    deviceId: authenticator.deviceId,
    assertion: authenticator.assert(hashedUserId(userId), webAuthnChallenge(payload), overrides),
  });
}

export const webAuthnSuite: Suite = ({ describe, it }) => {
  describe("T-003-04 pass-webauthn codecs", () => {
    it("attestations and assertions round-trip in papi-signers' layout", () => {
      const random = new Random(0xa77e);
      for (let run = 0; run < 50; run++) {
        const authenticator = device(random);
        const attestation = authenticator.attest(random.bytes(32));
        const bytes = attestationCodec.enc(attestation);
        assertEqual(decodeExact(attestationCodec, bytes), attestation);
        // authority_id (32) ‖ device_id (32) ‖ context u32 LE, then the byte vectors.
        assertEqual(bytes.subarray(0, 32), KREIVO_AUTHORITY_ID);
        assertEqual(bytes.subarray(32, 64), authenticator.deviceId);
        assertEqual(Array.from(bytes.subarray(64, 68)), [0, 0, 0, 0]);

        const assertion = authenticator.assert(random.bytes(32), random.bytes(32));
        const assertionBytes = assertionCodec.enc(assertion);
        assertEqual(decodeExact(assertionCodec, assertionBytes), assertion);
        assertEqual(assertionBytes.subarray(32, 64), assertion.meta.user_id);
      }
    });

    it("registrations and authorisations round-trip through the credential envelope", () => {
      const random = new Random(0xe7e1);
      const userId = random.hex<string>(32);
      const authenticator = device(random);
      const registration = register(userId, authenticator);
      const authorisation = authorise(userId, authenticator, random.bytes(64));
      assertEqual(Array.from(registration.subarray(0, 2)), [0, 0], "version 0, kind 0");
      assertEqual(encodeRegistration(decodeRegistration(registration)), registration);
      assertEqual(encodeAuthorisation(decodeAuthorisation(authorisation)), authorisation);
    });
  });

  describe("T-003-04 pass-webauthn verification", () => {
    const random = new Random(0x0a55);
    const userId = random.hex<string>(32);
    const authenticator = device(random);
    const registration = register(userId, authenticator);
    const payload = random.bytes(97);

    it("valid: an assertion by the registered device verifies, for the holder's account", () => {
      const registered = registrationAccount(registration);
      assert(registered.ok, "the registration is accepted");
      assertEqual(registered.value.account, holderAccountId(userId));
      assertEqual(registered.value.credential, toHex(authenticator.deviceId));

      const authorisation = authorise(userId, authenticator, payload);
      assertEqual(accountOf(authorisation), registered);
      assert(verify(registration, payload, authorisation, CONFIG), "it verifies");
    });

    it("a high-S DER signature is normalised and verifies", () => {
      const authorisation = authorise(userId, authenticator, payload, { highS: true });
      assert(verify(registration, payload, authorisation, CONFIG));
    });

    const failures: [string, string, () => Authorisation, string?][] = [
      [
        "wrong type",
        "type",
        () => authorise(userId, authenticator, payload, { type: "webauthn.create" }),
      ],
      [
        "wrong challenge",
        "challenge",
        () =>
          authorise(userId, authenticator, payload, {
            challenge: webAuthnChallenge(random.bytes(97)),
          }),
      ],
      [
        "wrong RP id",
        "rp-id",
        () => authorise(userId, authenticator, payload, { rpId: "evil.example" }),
      ],
      [
        "missing user verification",
        "user-verification",
        () => authorise(userId, authenticator, payload, { userVerified: false }),
      ],
      ["unregistered device", "device", () => authorise(userId, device(random), payload)],
      ["another holder's user id", "user", () => authorise(random.hex(32), authenticator, payload)],
      [
        "a non-zero context",
        "context",
        () => authorise(userId, authenticator, payload, { context: 7 }),
      ],
      [
        "a foreign authority id",
        "authority",
        () =>
          authorise(userId, authenticator, payload, { authorityId: new Uint8Array(32).fill(1) }),
      ],
    ];
    for (const [name, reason, build] of failures) {
      it(`${name} fails`, () => {
        const authorisation = build();
        assert(!verify(registration, payload, authorisation, CONFIG), "it does not verify");
        const reg = decodeRegistration(registration);
        const auth = decodeAuthorisation(authorisation);
        if (reg.kind !== "passWebAuthn" || auth.kind !== "passWebAuthn") throw new Error("kind");
        assertEqual(checkWebAuthnAssertion(reg, payload, auth, CONFIG), reason, "for that reason");
      });
    }

    it("a device registered to a different RP id fails against this deployment", () => {
      const elsewhere = device(random, "other.example");
      const reg = register(userId, elsewhere);
      assert(!verify(reg, payload, authorise(userId, elsewhere, payload), CONFIG));
      assert(
        verify(reg, payload, authorise(userId, elsewhere, payload), { rpId: "other.example" }),
      );
    });

    it("an unregistered device's valid assertion fails against another device's registration", () => {
      const second = device(random);
      const authorisation = authorise(userId, second, payload);
      assert(verify(register(userId, second), payload, authorisation, CONFIG), "own registration");
      assert(!verify(registration, payload, authorisation, CONFIG), "not another device's");
    });

    it("REQ-CP-6: a second device registers to the same account under its own credential", () => {
      const second = device(random);
      const one = registrationAccount(registration);
      const two = registrationAccount(register(userId, second));
      assert(one.ok && two.ok);
      assertEqual(two.value.account, one.value.account);
      assert(two.value.credential !== one.value.credential, "distinct credentials");
    });

    it("a tampered payload, signature or authenticator data fails", () => {
      const authorisation = authorise(userId, authenticator, payload);
      const tampered = payload.slice();
      tampered[3] = (tampered[3] ?? 0) ^ 1;
      assert(!verify(registration, tampered, authorisation, CONFIG), "payload");

      const auth = decodeAuthorisation(authorisation);
      if (auth.kind !== "passWebAuthn") throw new Error("kind");
      const data = auth.assertion.authenticator_data.slice();
      data[36] = (data[36] ?? 0) ^ 1; // the sign counter
      const withData = { ...auth, assertion: { ...auth.assertion, authenticator_data: data } };
      assert(!verify(registration, payload, encodeAuthorisation(withData), CONFIG), "auth data");

      const sig = auth.assertion.signature.slice();
      sig[sig.length - 1] = (sig[sig.length - 1] ?? 0) ^ 1;
      const withSig = { ...auth, assertion: { ...auth.assertion, signature: sig } };
      assert(!verify(registration, payload, encodeAuthorisation(withSig), CONFIG), "signature");
    });

    it("a registration with a foreign authority, a non-zero context or no P-256 key is refused", () => {
      const reg = decodeRegistration(registration);
      if (reg.kind !== "passWebAuthn") throw new Error("kind");
      const variants = [
        { ...reg.attestation, meta: { ...reg.attestation.meta, context: 1 } },
        { ...reg.attestation, meta: { ...reg.attestation.meta, authority_id: new Uint8Array(32) } },
        { ...reg.attestation, public_key: reg.attestation.public_key.subarray(1) },
      ];
      for (const attestation of variants) {
        const bad = encodeRegistration({ ...reg, attestation });
        const result = registrationAccount(bad);
        assert(!result.ok && result.error.code === "ERR-InvalidAuthorisation");
        assert(!verify(bad, payload, authorise(userId, authenticator, payload), CONFIG));
      }
    });

    it("credentials of different kinds never verify each other", () => {
      const p256Registration = encodeRegistration({
        kind: "p256",
        publicKey: new Uint8Array(33).fill(2),
        signature: new Uint8Array(64),
      });
      assert(!verify(p256Registration, payload, authorise(userId, authenticator, payload), CONFIG));
    });
  });
};
