// T-003-03 — `p256` registration and verification (REQ-SDK-4, REQ-CP-6).

import { p256 } from "@noble/curves/nist.js";
import type { Authorisation, Registration } from "@ticketto/sdk";
import { toHex } from "../../src/bytes.js";
import {
  accountOf,
  decodeAuthorisation,
  encodeAuthorisation,
  encodeRegistration,
  registrationAccount,
  verify,
} from "../../src/credential/credential.js";
import {
  normaliseP256Signature,
  p256AuthorisationDigest,
  p256RegistrationDigest,
} from "../../src/credential/p256.js";
import { p256AccountId } from "../../src/derive.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { p256Key, signDigest, type TestKey } from "../keys.js";
import { Random } from "../random.js";

const CONFIG = { rpId: "kippu.example" };
const check = (r: Registration, p: Uint8Array, a: Authorisation) => verify(r, p, a, CONFIG);

function register(key: TestKey): Registration {
  return encodeRegistration({
    kind: "p256",
    publicKey: key.publicKey,
    signature: signDigest(key, p256RegistrationDigest(key.publicKey)),
  });
}

function authorise(key: TestKey, payload: Uint8Array, claimedKey = key): Authorisation {
  return encodeAuthorisation({
    kind: "p256",
    publicKey: claimedKey.publicKey,
    signature: signDigest(key, p256AuthorisationDigest(payload)),
  });
}

function flip(bytes: Uint8Array, index: number): Uint8Array {
  const out = bytes.slice();
  out[index] = (out[index] ?? 0) ^ 1;
  return out;
}

export const p256Suite: Suite = ({ describe, it }) => {
  describe("T-003-03 p256 credentials", () => {
    const random = new Random(0x9256);
    const alice = p256Key(random);
    const bob = p256Key(random);
    const payload = random.bytes(120);

    it("valid: a self-signed registration names the key's account; its authorisation verifies", () => {
      const registration = register(alice);
      const registered = registrationAccount(registration);
      assert(registered.ok, "the registration is accepted");
      assertEqual(registered.value.account, p256AccountId(alice.publicKey));
      assertEqual(registered.value.credential, toHex(alice.publicKey));

      const authorisation = authorise(alice, payload);
      assertEqual(accountOf(authorisation), registered);
      assert(check(registration, payload, authorisation), "the authorisation verifies");
    });

    it("tampered payload: an authorisation does not verify over any other payload", () => {
      const registration = register(alice);
      const authorisation = authorise(alice, payload);
      for (const index of [0, 1, 60, payload.length - 1]) {
        assert(!check(registration, flip(payload, index), authorisation), `byte ${index}`);
      }
      assert(!check(registration, payload.subarray(1), authorisation), "a shorter payload");
    });

    it("tampered authorisation: a changed signature does not verify", () => {
      const registration = register(alice);
      const authorisation = authorise(alice, payload);
      // version, kind, public key (33): the signature follows at 35.
      for (const index of [35, 66, 98]) {
        assert(!check(registration, payload, flip(authorisation, index) as Authorisation));
      }
    });

    it("wrong key: a signature by one key claiming another key's public key fails", () => {
      const registration = register(alice);
      assert(!check(registration, payload, authorise(bob, payload, alice)));
    });

    it("unregistered key: a valid authorisation by a key not in the registration fails", () => {
      const authorisation = authorise(bob, payload);
      assert(check(register(bob), payload, authorisation), "it verifies against its own key");
      assert(!check(register(alice), payload, authorisation), "not against another's");
    });

    it("a registration not signed by its own key is refused", () => {
      const forged = encodeRegistration({
        kind: "p256",
        publicKey: alice.publicKey,
        signature: signDigest(bob, p256RegistrationDigest(alice.publicKey)),
      });
      const result = registrationAccount(forged);
      assert(!result.ok && result.error.code === "ERR-InvalidAuthorisation");
      assert(!check(forged, payload, authorise(alice, payload)), "nor does it verify anything");
    });

    it("a registration signature is not an authorisation, nor the reverse", () => {
      const registration = register(alice);
      const asAuthorisation = registration as Uint8Array as Authorisation;
      assert(!check(registration, alice.publicKey, asAuthorisation));
      assert(!check(registration, payload, asAuthorisation));
    });

    it("a high-S signature is refused; normalising it restores it", () => {
      const registration = register(alice);
      const good = decodeAuthorisation(authorise(alice, payload));
      if (good.kind !== "p256") throw new Error("unreachable");
      const parsed = p256.Signature.fromBytes(good.signature, "compact");
      const high = new p256.Signature(parsed.r, p256.Point.Fn.ORDER - parsed.s);
      const highAuth = encodeAuthorisation({ ...good, signature: high.toBytes("compact") });
      assert(!check(registration, payload, highAuth), "high S is malleable and refused");

      const fromDer = normaliseP256Signature(high.toBytes("der"), "der");
      assertEqual(fromDer, good.signature, "DER high-S normalises to the low-S form");
      assert(check(registration, payload, encodeAuthorisation({ ...good, signature: fromDer })));
    });

    it("malformed bytes are ERR-InvalidAuthorisation and never verify", () => {
      const registration = register(alice);
      const authorisation = authorise(alice, payload);
      const cases = [
        new Uint8Array(0),
        authorisation.subarray(0, 50),
        flip(authorisation, 0), // unknown format version
        Uint8Array.of(0, 9, ...authorisation.subarray(2)), // unknown kind
      ];
      for (const bytes of cases) {
        const result = accountOf(bytes as Authorisation);
        assert(!result.ok && result.error.code === "ERR-InvalidAuthorisation");
        assert(!check(registration, payload, bytes as Authorisation));
        const reg = registrationAccount(bytes as Registration);
        assert(!reg.ok && reg.error.code === "ERR-InvalidAuthorisation");
      }
    });
  });
};
