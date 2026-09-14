// The `pass-webauthn` credential kind: holders' passkeys, as Kreivo Pass
// accounts use them (AD-10 as ruled; features/003-profile-v0/plan.md §5.2).
//
// `Attestation` and `Assertion` are byte for byte the SCALE structures of
// virto-network/papi-signers (`authenticators/webauthn/src/types.ts`), so a
// registration made here can be carried to Kreivo (REQ-MG-6):
//
//   AttestationMeta = { authority_id [u8;32], device_id [u8;32], context u32 }
//   Attestation     = { meta, authenticator_data Vec<u8>, client_data Vec<u8>, public_key Vec<u8> }
//   AssertionMeta   = { authority_id [u8;32], user_id [u8;32], context u32 }
//   Assertion       = { meta, authenticator_data Vec<u8>, client_data Vec<u8>, signature Vec<u8> }
//
// The hosted ledger has no blocks, so `context` is 0 in V0. An assertion's
// challenge is BLAKE2b-256(payload), where the payload is already
// domain-separated (`signing.ts`); a registration's challenge is
// BLAKE2b-256("ticketto/v0/registration" ‖ account) (plan §5.7). Freshness comes
// from the operation envelope's expiry and the pass window, which the rules
// enforce.

import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Codec, Struct, u32 } from "scale-ts";
import { ascii, concatBytes, equalBytes, fromHex, toBase64Url, utf8Decode } from "../bytes.js";
import { boundedBytes, fixedBytes } from "../codec/scale.js";
import { blake2b256, holderAccountFromHashedUserId } from "../derive.js";
import { registrationChallenge } from "../signing.js";
import { normaliseP256Signature } from "./p256.js";

/** `"kreivo_p"`, zero-padded to 32 bytes: papi-signers' `KREIVO_AUTHORITY_ID`. */
export const KREIVO_AUTHORITY_ID: Uint8Array = concatBytes(ascii("kreivo_p"), new Uint8Array(24));

/** The only `context` V0 issues or accepts (plan §5.2). */
export const V0_CONTEXT = 0;

export interface AttestationMeta {
  readonly authority_id: Uint8Array;
  readonly device_id: Uint8Array;
  readonly context: number;
}

export interface Attestation {
  readonly meta: AttestationMeta;
  readonly authenticator_data: Uint8Array;
  readonly client_data: Uint8Array;
  /** SubjectPublicKeyInfo, DER, as `AuthenticatorAttestationResponse.getPublicKey()` returns it. */
  readonly public_key: Uint8Array;
}

export interface AssertionMeta {
  readonly authority_id: Uint8Array;
  /** The hashed user id: `SHA-256(userId)`. */
  readonly user_id: Uint8Array;
  readonly context: number;
}

export interface Assertion {
  readonly meta: AssertionMeta;
  readonly authenticator_data: Uint8Array;
  readonly client_data: Uint8Array;
  /** DER, as `AuthenticatorAssertionResponse.signature` returns it. */
  readonly signature: Uint8Array;
}

const bytes32 = fixedBytes(32);

export const attestationCodec: Codec<Attestation> = Struct({
  meta: Struct({ authority_id: bytes32, device_id: bytes32, context: u32 }),
  authenticator_data: boundedBytes,
  client_data: boundedBytes,
  public_key: boundedBytes,
});

export const assertionCodec: Codec<Assertion> = Struct({
  meta: Struct({ authority_id: bytes32, user_id: bytes32, context: u32 }),
  authenticator_data: boundedBytes,
  client_data: boundedBytes,
  signature: boundedBytes,
});

/** A holder's registration: the hashed user id naming the account, and the device's attestation. */
export interface WebAuthnRegistration {
  readonly hashedUserId: Uint8Array;
  readonly attestation: Attestation;
}

/** A holder's authorisation: the device that signed, and its assertion. */
export interface WebAuthnAuthorisation {
  readonly deviceId: Uint8Array;
  readonly assertion: Assertion;
}

export const webAuthnRegistrationCodec: Codec<WebAuthnRegistration> = Struct({
  hashedUserId: bytes32,
  attestation: attestationCodec,
});

export const webAuthnAuthorisationCodec: Codec<WebAuthnAuthorisation> = Struct({
  deviceId: bytes32,
  assertion: assertionCodec,
});

/** Deployment configuration of the `pass-webauthn` kind. */
export interface WebAuthnConfig {
  /**
   * The WebAuthn relying party id. Changing it invalidates every holder passkey,
   * so it is a profile change, and therefore a migration (plan §5.3, `REQ-MG-6`).
   */
  readonly rpId: string;
}

/**
 * The WebAuthn challenge for `payload`: `BLAKE2b-256(payload)` (plan §5.2). The
 * payload is a signing payload — `commandSigningPayload` or
 * `passSigningPayload` — which carries its domain tag (plan §5.7).
 */
export function webAuthnChallenge(payload: Uint8Array): Uint8Array {
  return blake2b256(payload);
}

// SubjectPublicKeyInfo for an id-ecPublicKey on prime256v1, up to the point.
export const P256_SPKI_PREFIX: Uint8Array = fromHex(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
);
const UNCOMPRESSED_POINT_LENGTH = 65;

/** The uncompressed P-256 point of a DER SubjectPublicKeyInfo, or `null` if it is not one. */
export function p256PointFromSpki(spki: Uint8Array): Uint8Array | null {
  if (spki.length !== P256_SPKI_PREFIX.length + UNCOMPRESSED_POINT_LENGTH) return null;
  if (!equalBytes(spki.subarray(0, P256_SPKI_PREFIX.length), P256_SPKI_PREFIX)) return null;
  const point = spki.slice(P256_SPKI_PREFIX.length);
  try {
    p256.Point.fromBytes(point).assertValidity();
    return point;
  } catch {
    return null;
  }
}

/** Authenticator data flags (WebAuthn §6.1). */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const RP_ID_HASH_LENGTH = 32;
const FLAGS_OFFSET = 32;
const MIN_AUTHENTICATOR_DATA_LENGTH = 37;

/** Why a `pass-webauthn` check failed; `null` when it passed. */
export type WebAuthnFailure =
  | "authority"
  | "context"
  | "public-key"
  | "user"
  | "device"
  | "client-data"
  | "type"
  | "challenge"
  | "rp-id"
  | "user-presence"
  | "user-verification"
  | "signature";

/** The `challenge` of client data JSON bytes, or `null` when they are not client data. */
function clientDataChallenge(
  clientData: Uint8Array,
): { readonly type: unknown; readonly challenge: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(clientData));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { type, challenge } = parsed as { type?: unknown; challenge?: unknown };
  return { type, challenge };
}

/**
 * Checks a registration on its own: authority, context, public key, and that its
 * challenge is `BLAKE2b-256("ticketto/v0/registration" ‖ account)` for the
 * account its hashed user id names (plan §5.7, ruling 1).
 */
export function checkWebAuthnRegistration(
  registration: WebAuthnRegistration,
): WebAuthnFailure | null {
  const { meta, public_key, client_data } = registration.attestation;
  if (!equalBytes(meta.authority_id, KREIVO_AUTHORITY_ID)) return "authority";
  if (meta.context !== V0_CONTEXT) return "context";
  if (p256PointFromSpki(public_key) === null) return "public-key";
  const clientData = clientDataChallenge(client_data);
  if (clientData === null) return "client-data";
  const account = holderAccountFromHashedUserId(registration.hashedUserId);
  if (clientData.challenge !== toBase64Url(registrationChallenge(account))) return "challenge";
  return null;
}

/**
 * Checks an assertion over `payload` against a registered device, following
 * plan §5.2's verification steps. Returns the first failure, or `null`.
 */
export function checkWebAuthnAssertion(
  registration: WebAuthnRegistration,
  payload: Uint8Array,
  authorisation: WebAuthnAuthorisation,
  config: WebAuthnConfig,
): WebAuthnFailure | null {
  const registered = checkWebAuthnRegistration(registration);
  if (registered !== null) return registered;
  const { assertion } = authorisation;
  if (!equalBytes(assertion.meta.authority_id, KREIVO_AUTHORITY_ID)) return "authority";
  if (assertion.meta.context !== V0_CONTEXT) return "context";

  // 1. `user_id` hashes to the account: the registration's hashed user id.
  if (!equalBytes(assertion.meta.user_id, registration.hashedUserId)) return "user";

  // 2. (account, deviceId) is registered; its public key is used.
  if (!equalBytes(authorisation.deviceId, registration.attestation.meta.device_id)) return "device";
  const publicKey = p256PointFromSpki(registration.attestation.public_key);
  if (publicKey === null) return "public-key";

  // 3. clientDataJSON is a `webauthn.get` over the payload hash.
  const clientData = clientDataChallenge(assertion.client_data);
  if (clientData === null) return "client-data";
  if (clientData.type !== "webauthn.get") return "type";
  if (clientData.challenge !== toBase64Url(webAuthnChallenge(payload))) return "challenge";

  // 4. The RP id hash is the deployment's, and the user was present and verified.
  const authData = assertion.authenticator_data;
  if (authData.length < MIN_AUTHENTICATOR_DATA_LENGTH) return "rp-id";
  let rpIdHash: Uint8Array;
  try {
    rpIdHash = sha256(ascii(config.rpId));
  } catch {
    return "rp-id";
  }
  if (!equalBytes(authData.subarray(0, RP_ID_HASH_LENGTH), rpIdHash)) return "rp-id";
  const flags = authData[FLAGS_OFFSET] ?? 0;
  if ((flags & FLAG_USER_PRESENT) === 0) return "user-presence";
  if ((flags & FLAG_USER_VERIFIED) === 0) return "user-verification";

  // 5. ECDSA P-256 over authenticatorData ‖ SHA-256(clientDataJSON), DER normalised to low S.
  let signature: Uint8Array;
  try {
    signature = normaliseP256Signature(assertion.signature, "der");
  } catch {
    return "signature";
  }
  const signed = concatBytes(authData, sha256(assertion.client_data));
  try {
    if (!p256.verify(signature, signed, publicKey, { prehash: true, lowS: true })) {
      return "signature";
    }
  } catch {
    return "signature";
  }
  return null;
}
