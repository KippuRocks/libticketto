// The `p256` credential kind: Kippu's own server keys — organiser authority,
// the sponsor, the publication key (features/003-profile-v0/plan.md §5.2).
//
//   Account        BLAKE2b-256("ticketto/v0/account/p256" ‖ compressed public key)
//   Registration   the public key, signed by itself: ECDSA P-256 over
//                  BLAKE2b-256("ticketto/v0/registration/p256" ‖ public key)
//   Authorisation  ECDSA P-256 over BLAKE2b-256(payload), plus the public key
//
// Signatures are 64-byte `r ‖ s` with low S. A DER signature, as a KMS returns,
// is normalised to that form by `normaliseP256Signature`.

import { p256 } from "@noble/curves/nist.js";
import { ascii, concatBytes, equalBytes } from "../bytes.js";
import { blake2b256, P256_PUBLIC_KEY_LENGTH } from "../derive.js";

/** Bytes in a `p256` signature: `r ‖ s`. */
export const P256_SIGNATURE_LENGTH = 64;

export const P256_REGISTRATION_TAG = ascii("ticketto/v0/registration/p256");

const ECDSA_OPTIONS = { prehash: false, lowS: true } as const;

/** A public key and a signature by it. Both a `p256` registration and authorisation have this shape. */
export interface P256Signed {
  /** Compressed SEC1 public key, 33 bytes. */
  readonly publicKey: Uint8Array;
  /** `r ‖ s`, 64 bytes, low S. */
  readonly signature: Uint8Array;
}

/** The digest a `p256` credential signs to authorise `payload`. */
export function p256AuthorisationDigest(payload: Uint8Array): Uint8Array {
  return blake2b256(payload);
}

/** The digest a `p256` key signs to register itself. */
export function p256RegistrationDigest(publicKey: Uint8Array): Uint8Array {
  return blake2b256(concatBytes(P256_REGISTRATION_TAG, publicKey));
}

/** Whether `publicKey` is a compressed encoding of a point on P-256. */
export function isP256PublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== P256_PUBLIC_KEY_LENGTH) return false;
  try {
    p256.Point.fromBytes(publicKey).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/**
 * `signature`, in DER (as WebAuthn authenticators and KMS services return it) or
 * 64-byte `r ‖ s`, as 64-byte `r ‖ s` with low S. Throws a `TypeError` when
 * `signature` is not in the stated format.
 */
export function normaliseP256Signature(
  signature: Uint8Array,
  format: "der" | "compact",
): Uint8Array {
  let parsed: ReturnType<typeof p256.Signature.fromBytes>;
  try {
    parsed = p256.Signature.fromBytes(signature, format);
  } catch {
    throw new TypeError(`expected a ${format} P-256 signature`);
  }
  const lowS = parsed.hasHighS()
    ? new p256.Signature(parsed.r, p256.Point.Fn.ORDER - parsed.s)
    : parsed;
  return lowS.toBytes("compact");
}

function verifyDigest(signed: P256Signed, digest: Uint8Array): boolean {
  if (signed.signature.length !== P256_SIGNATURE_LENGTH) return false;
  if (!isP256PublicKey(signed.publicKey)) return false;
  try {
    return p256.verify(signed.signature, digest, signed.publicKey, ECDSA_OPTIONS);
  } catch {
    return false;
  }
}

/** Whether a `p256` registration is its public key, validly signed by itself. */
export function verifyP256Registration(registration: P256Signed): boolean {
  return verifyDigest(registration, p256RegistrationDigest(registration.publicKey));
}

/**
 * Whether `authorisation` over `payload` was produced by the key `registration`
 * registered (`REQ-SDK-4`). The registration itself must also verify.
 */
export function verifyP256(
  registration: P256Signed,
  payload: Uint8Array,
  authorisation: P256Signed,
): boolean {
  return (
    equalBytes(registration.publicKey, authorisation.publicKey) &&
    verifyP256Registration(registration) &&
    verifyDigest(authorisation, p256AuthorisationDigest(payload))
  );
}
