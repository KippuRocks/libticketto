// Software signers for tests and the conformance suite only
// (features/003-profile-v0/plan.md §5.6, REQ-CP-5). They produce valid V0
// authorisations and registrations without hardware. Their secret keys are
// plain bytes in memory: never use them for a real holder, organiser or sponsor.

import { p256 } from "@noble/curves/nist.js";
import { randomBytes } from "@noble/hashes/utils.js";
import type { AccountId, Authorisation, Registration, Signer } from "@ticketto/sdk";
import { fromHex, toHex } from "../bytes.js";
import { encodeAuthorisation, encodeRegistration } from "../credential/credential.js";
import { p256AuthorisationDigest, p256RegistrationDigest } from "../credential/p256.js";
import { webAuthnChallenge } from "../credential/webauthn.js";
import { hashedUserId, holderAccountId, p256AccountId } from "../derive.js";
import { SimulatedWebAuthnAuthenticator } from "./webauthn-authenticator.js";

/** A signer together with the registration that registers its credential (`REQ-CP-6`). */
export interface SoftwareCredential {
  readonly signer: Signer;
  readonly registration: Registration;
}

function secretKeyFrom(bytes: Uint8Array | undefined): Uint8Array {
  if (bytes !== undefined) {
    if (!p256.utils.isValidSecretKey(bytes))
      throw new TypeError("expected a valid P-256 secret key");
    return bytes.slice();
  }
  return p256.utils.randomSecretKey();
}

export interface SoftwareP256Options {
  /** A 32-byte P-256 secret key. Defaults to a fresh random one. */
  readonly secretKey?: Uint8Array;
}

/** A `p256` credential in software: the kind Kippu's server keys use. */
export interface SoftwareP256Credential extends SoftwareCredential {
  /** Compressed public key. */
  readonly publicKey: Uint8Array;
}

export function softwareP256Signer(options: SoftwareP256Options = {}): SoftwareP256Credential {
  const secretKey = secretKeyFrom(options.secretKey);
  const publicKey = p256.getPublicKey(secretKey, true);
  const sign = (digest: Uint8Array) => p256.sign(digest, secretKey, { prehash: false, lowS: true });
  return {
    publicKey,
    signer: {
      account: p256AccountId(publicKey),
      sign: async (payload: Uint8Array): Promise<Authorisation> =>
        encodeAuthorisation({
          kind: "p256",
          publicKey,
          signature: sign(p256AuthorisationDigest(payload)),
        }),
    },
    registration: encodeRegistration({
      kind: "p256",
      publicKey,
      signature: sign(p256RegistrationDigest(publicKey)),
    }),
  };
}

export interface SimulatedWebAuthnOptions {
  /** The deployment's WebAuthn RP id. */
  readonly rpId: string;
  /** The holder's user id: 32 bytes as lower-case hex. Defaults to a fresh random one. */
  readonly userId?: string;
  /** The device's P-256 secret key. Defaults to a fresh random one. */
  readonly secretKey?: Uint8Array;
  /** The credential's raw id. Defaults to 32 fresh random bytes. */
  readonly credentialId?: Uint8Array;
}

/** A holder's `pass-webauthn` credential on a simulated device. */
export interface SimulatedWebAuthnCredential extends SoftwareCredential {
  readonly userId: string;
  readonly authenticator: SimulatedWebAuthnAuthenticator;
}

/**
 * A holder credential on a simulated passkey device. Its registration carries
 * an attestation whose challenge is `BLAKE2b-256(account)`; the profile does not
 * interpret it. Each `sign` is a full WebAuthn assertion ceremony.
 */
export function simulatedWebAuthnSigner(
  options: SimulatedWebAuthnOptions,
): SimulatedWebAuthnCredential {
  const userId = options.userId ?? toHex(randomBytes(32));
  const account: AccountId = holderAccountId(userId);
  const hashed = hashedUserId(userId);
  const authenticator = new SimulatedWebAuthnAuthenticator({
    rpId: options.rpId,
    secretKey: secretKeyFrom(options.secretKey),
    credentialId: options.credentialId ?? randomBytes(32),
  });
  return {
    userId,
    authenticator,
    signer: {
      account,
      sign: async (payload: Uint8Array): Promise<Authorisation> =>
        encodeAuthorisation({
          kind: "passWebAuthn",
          deviceId: authenticator.deviceId,
          assertion: authenticator.assert(hashed, webAuthnChallenge(payload)),
        }),
    },
    registration: encodeRegistration({
      kind: "passWebAuthn",
      hashedUserId: hashed,
      attestation: authenticator.attest(webAuthnChallenge(fromHex(account))),
    }),
  };
}
