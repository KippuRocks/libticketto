/// <reference types="node" />
// T-003-10 — compatibility with virto-network/papi-signers (REQ-MG-6, REQ-CP-6).
//
// Holders reach Kreivo without re-attestation only if this profile derives the
// same accounts and device ids, and encodes attestations and assertions to the
// same bytes, as `@virtonetwork/signer` and `@virtonetwork/authenticators-webauthn`.
// Their `WebAuthn` authenticator runs here unmodified, against a
// `navigator.credentials` backed by the simulated authenticator, with the V0
// challenger (no block hash: `BLAKE2b-256(xtc)`, context 0). Every comparison
// is against their output; a divergence fails CI.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Authorisation, Registration } from "@ticketto/sdk";
import {
  KREIVO_AUTHORITY_ID as THEIR_AUTHORITY_ID,
  WebAuthn,
} from "@virtonetwork/authenticators-webauthn";
import { beforeAll, describe, expect, it } from "vitest";
import { p256Key } from "../../test/keys.js";
import { Random } from "../../test/random.js";
import { toHex } from "../bytes.js";
import { decodeExact } from "../codec/scale.js";
import { blake2b256, deviceId, hashedUserId, holderAccountId } from "../derive.js";
import { SimulatedWebAuthnAuthenticator } from "../testing/webauthn-authenticator.js";
import {
  accountOf,
  decodeAuthorisation,
  encodeAuthorisation,
  encodeRegistration,
  registrationAccount,
  verify,
} from "./credential.js";
import {
  type Assertion,
  type Attestation,
  assertionCodec,
  attestationCodec,
  KREIVO_AUTHORITY_ID,
  V0_CONTEXT,
  webAuthnChallenge,
} from "./webauthn.js";

const RP_ID = "kippu.example";

interface Encoder {
  enc(value: unknown): Uint8Array;
}

// papi-signers' Attestation codec. The package exports only `WebAuthn`, so it is
// loaded from its published build.
let theirAttestation: Encoder;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("@virtonetwork/authenticators-webauthn/package.json");
  const types = (await import(new URL("dist/esm/types.js", pathToFileURL(manifest)).href)) as {
    Attestation: Encoder;
  };
  // `register` returns the structure; `authenticate` already returns `Assertion.enc` bytes.
  theirAttestation = types.Attestation;
});

/** What the stubbed `navigator.credentials` last returned. */
interface Ceremony {
  rawId: Uint8Array;
  attestation?: Attestation;
  assertion?: Omit<Assertion, "meta">;
}

const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

function installCredentials(authenticator: SimulatedWebAuthnAuthenticator, ceremony: Ceremony) {
  const credentials = {
    create: async (options: { publicKey: { challenge: Uint8Array } }) => {
      const attestation = authenticator.attest(new Uint8Array(options.publicKey.challenge));
      ceremony.attestation = attestation;
      return {
        id: toHex(authenticator.credentialId),
        rawId: buffer(authenticator.credentialId),
        type: "public-key",
        response: {
          clientDataJSON: buffer(attestation.client_data),
          getAuthenticatorData: () => buffer(attestation.authenticator_data),
          getPublicKey: () => buffer(attestation.public_key),
        },
      };
    },
    get: async (options: { publicKey: { challenge: Uint8Array } }) => {
      // The user id in `meta` is filled by papi-signers; only the ceremony output matters here.
      const { authenticator_data, client_data, signature } = authenticator.assert(
        new Uint8Array(32),
        new Uint8Array(options.publicKey.challenge),
      );
      ceremony.assertion = { authenticator_data, client_data, signature };
      return {
        id: toHex(authenticator.credentialId),
        rawId: buffer(authenticator.credentialId),
        type: "public-key",
        response: {
          authenticatorData: buffer(authenticator_data),
          clientDataJSON: buffer(client_data),
          signature: buffer(signature),
        },
      };
    },
  };
  Object.defineProperty(globalThis.navigator, "credentials", {
    value: credentials,
    configurable: true,
  });
}

/** The V0 challenger: papi-signers' `blockHashChallenger` with no block hash to mix in. */
const v0Challenger = (_context: number, xtc: Uint8Array) => blake2b256(xtc);

describe("T-003-10 compatibility with @virtonetwork/signer and authenticators-webauthn", () => {
  const random = new Random(0xc0de_ba5e);
  const runs = Array.from({ length: 10 }, () => ({
    userId: random.hex<string>(32),
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(16 + random.below(48)),
    payload: random.bytes(random.below(300)),
  }));

  it("uses the same authority id", () => {
    expect(toHex(KREIVO_AUTHORITY_ID)).toBe(toHex(THEIR_AUTHORITY_ID.asBytes()));
  });

  it.each(runs.map((run, i) => [i, run] as const))(
    "run %i: identical account id, device id, attestation and assertion bytes",
    async (_i, { userId, secretKey, credentialId, payload }) => {
      const authenticator = new SimulatedWebAuthnAuthenticator({
        rpId: RP_ID,
        secretKey,
        credentialId,
      });
      const ceremony: Ceremony = { rawId: credentialId };
      installCredentials(authenticator, ceremony);

      const theirs = await new WebAuthn(userId, v0Challenger).setup();

      // Account ids.
      expect(toHex(hashedUserId(userId))).toBe(toHex(theirs.hashedUserId));
      expect(holderAccountId(userId)).toBe(toHex(theirs.addressGenerator(theirs.hashedUserId)));

      // Registration: device id and attestation bytes.
      const theirAttestationValue = await theirs.register(V0_CONTEXT);
      const theirAttestationBytes = theirAttestation.enc(theirAttestationValue);
      expect(toHex(theirAttestationValue.meta.device_id.asBytes())).toBe(
        toHex(deviceId(credentialId)),
      );
      const created = ceremony.attestation;
      if (created === undefined) throw new Error("no attestation ceremony");
      const ourAttestation: Attestation = {
        meta: { authority_id: KREIVO_AUTHORITY_ID, device_id: deviceId(credentialId), context: 0 },
        authenticator_data: created.authenticator_data,
        client_data: created.client_data,
        public_key: created.public_key,
      };
      expect(toHex(attestationCodec.enc(ourAttestation))).toBe(toHex(theirAttestationBytes));
      expect(decodeExact(attestationCodec, theirAttestationBytes)).toEqual(ourAttestation);

      // Authentication: device id and assertion bytes.
      const authenticated = await theirs.authenticate(V0_CONTEXT, payload);
      if (authenticated === undefined) throw new Error("no assertion");
      expect(authenticated.credentials.tag).toBe("WebAuthn");
      expect(toHex(authenticated.deviceId.asBytes())).toBe(toHex(deviceId(credentialId)));
      const asserted = ceremony.assertion;
      if (asserted === undefined) throw new Error("no assertion ceremony");
      const ourAssertion: Assertion = {
        meta: { authority_id: KREIVO_AUTHORITY_ID, user_id: hashedUserId(userId), context: 0 },
        ...asserted,
      };
      expect(toHex(assertionCodec.enc(ourAssertion))).toBe(toHex(authenticated.credentials.value));
      // What papi-signers produced is accepted by this profile, for the holder's account.
      const registration: Registration = encodeRegistration({
        kind: "passWebAuthn",
        hashedUserId: theirs.hashedUserId,
        attestation: decodeExact(attestationCodec, theirAttestationBytes),
      });
      const authorisation: Authorisation = encodeAuthorisation({
        kind: "passWebAuthn",
        deviceId: authenticated.deviceId.asBytes(),
        assertion: decodeExact(assertionCodec, authenticated.credentials.value),
      });
      const registered = registrationAccount(registration);
      expect(registered.ok && registered.value.account).toBe(holderAccountId(userId));
      expect(accountOf(authorisation)).toEqual(registered);
      expect(verify(registration, payload, authorisation, { rpId: RP_ID })).toBe(true);
      expect(decodeAuthorisation(authorisation).kind).toBe("passWebAuthn");
      expect(toHex(webAuthnChallenge(payload))).toBe(toHex(v0Challenger(0, payload)));
    },
  );
});
