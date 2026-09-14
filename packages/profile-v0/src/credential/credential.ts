// Registrations and authorisations as the SDK carries them: opaque bytes that
// only this profile reads (REQ-SDK-4, REQ-CP-3; features/003-profile-v0/plan.md §5.2).
//
//   Registration  = version u8, kind u8, body
//   Authorisation = version u8, kind u8, body
//
// | kind | name            | registration body                 | authorisation body          |
// |------|-----------------|-----------------------------------|-----------------------------|
// | 0    | `pass-webauthn` | hashedUserId [u8;32], Attestation | deviceId [u8;32], Assertion |
// | 1    | `p256`          | public key [u8;33], sig [u8;64]   | public key, sig             |
//
// A further kind takes the next free index.

import type {
  Authorisation,
  CredentialAccount,
  CredentialId,
  Registration,
  Result,
} from "@ticketto/sdk";
import { type Codec, createCodec, createDecoder, u8 } from "scale-ts";
import { concatBytes, toHex } from "../bytes.js";
import { DecodeError, decodeVersioned, encodeVersioned, fixedBytes } from "../codec/scale.js";
import { holderAccountFromHashedUserId, P256_PUBLIC_KEY_LENGTH, p256AccountId } from "../derive.js";
import { err, ok } from "../result.js";
import {
  P256_SIGNATURE_LENGTH,
  type P256Signed,
  verifyP256,
  verifyP256Registration,
} from "./p256.js";
import {
  checkWebAuthnAssertion,
  checkWebAuthnRegistration,
  KREIVO_AUTHORITY_ID,
  type WebAuthnAuthorisation,
  type WebAuthnConfig,
  type WebAuthnRegistration,
  webAuthnAuthorisationCodec,
  webAuthnRegistrationCodec,
} from "./webauthn.js";

/** Wire index of each credential kind. Part of `C2`. */
export const CREDENTIAL_KIND_INDEX = { passWebAuthn: 0, p256: 1 } as const;

export type RegistrationValue =
  | ({ readonly kind: "passWebAuthn" } & WebAuthnRegistration)
  | ({ readonly kind: "p256" } & P256Signed);

export type AuthorisationValue =
  | ({ readonly kind: "passWebAuthn" } & WebAuthnAuthorisation)
  | ({ readonly kind: "p256" } & P256Signed);

/** Everything verification needs beyond the bytes it is given. */
export type CredentialConfig = WebAuthnConfig;

const publicKey = fixedBytes(P256_PUBLIC_KEY_LENGTH);
const signature = fixedBytes(P256_SIGNATURE_LENGTH);

const p256Body: Codec<P256Signed> = createCodec(
  (value: P256Signed) =>
    concatBytes(publicKey.enc(value.publicKey), signature.enc(value.signature)),
  createDecoder((input) => ({ publicKey: publicKey.dec(input), signature: signature.dec(input) })),
);

function kindCodec<W>(
  webAuthn: Codec<W>,
): Codec<({ readonly kind: "passWebAuthn" } & W) | ({ readonly kind: "p256" } & P256Signed)> {
  type Value = ({ readonly kind: "passWebAuthn" } & W) | ({ readonly kind: "p256" } & P256Signed);
  return createCodec(
    (value: Value) => {
      switch (value.kind) {
        case "passWebAuthn":
          return concatBytes(u8.enc(CREDENTIAL_KIND_INDEX.passWebAuthn), webAuthn.enc(value));
        case "p256":
          return concatBytes(u8.enc(CREDENTIAL_KIND_INDEX.p256), p256Body.enc(value));
        default:
          throw new TypeError("unknown credential kind");
      }
    },
    createDecoder((input): Value => {
      const index = u8.dec(input);
      if (index === CREDENTIAL_KIND_INDEX.passWebAuthn) {
        return { kind: "passWebAuthn", ...webAuthn.dec(input) } as Value;
      }
      if (index === CREDENTIAL_KIND_INDEX.p256) return { kind: "p256", ...p256Body.dec(input) };
      throw new DecodeError(`unknown credential kind index ${index}`);
    }),
  );
}

const registrationCodec: Codec<RegistrationValue> = kindCodec(webAuthnRegistrationCodec);
const authorisationCodec: Codec<AuthorisationValue> = kindCodec(webAuthnAuthorisationCodec);

export function encodeRegistration(value: RegistrationValue): Registration {
  return encodeVersioned(registrationCodec, value) as Registration;
}

/** The registration `bytes` encode. Throws `DecodeError` otherwise. */
export function decodeRegistration(bytes: Uint8Array): RegistrationValue {
  return decodeVersioned(registrationCodec, bytes);
}

export function encodeAuthorisation(value: AuthorisationValue): Authorisation {
  return encodeVersioned(authorisationCodec, value) as Authorisation;
}

/** The authorisation `bytes` encode. Throws `DecodeError` otherwise. */
export function decodeAuthorisation(bytes: Uint8Array): AuthorisationValue {
  return decodeVersioned(authorisationCodec, bytes);
}

function p256Account(signed: P256Signed): CredentialAccount {
  return {
    account: p256AccountId(signed.publicKey),
    credential: toHex(signed.publicKey) as CredentialId,
  };
}

function webAuthnAccount(hashedUserId: Uint8Array, deviceId: Uint8Array): CredentialAccount {
  return {
    account: holderAccountFromHashedUserId(hashedUserId),
    credential: toHex(deviceId) as CredentialId,
  };
}

/**
 * The account a registration registers a credential to, and that credential
 * (`Profile.registrationAccount`, `REQ-CP-6`). A `p256` registration must be
 * validly self-signed; a `pass-webauthn` one must carry Kreivo's authority id,
 * context 0 and a P-256 public key. Anything else fails with
 * `ERR-InvalidAuthorisation`.
 */
export function registrationAccount(registration: Registration): Result<CredentialAccount> {
  let value: RegistrationValue;
  try {
    value = decodeRegistration(registration);
  } catch (error) {
    return err("ERR-InvalidAuthorisation", `malformed registration: ${String(error)}`);
  }
  switch (value.kind) {
    case "p256":
      if (!verifyP256Registration(value)) {
        return err("ERR-InvalidAuthorisation", "the key does not sign its own registration");
      }
      return ok(p256Account(value));
    case "passWebAuthn": {
      const failure = checkWebAuthnRegistration(value);
      if (failure !== null) return err("ERR-InvalidAuthorisation", `attestation: ${failure}`);
      return ok(webAuthnAccount(value.hashedUserId, value.attestation.meta.device_id));
    }
    default:
      return err("ERR-InvalidAuthorisation", "unknown credential kind");
  }
}

/**
 * The account, and credential, an authorisation claims to come from
 * (`Profile.accountOf`). Does not verify it: that needs the registration.
 */
export function accountOf(authorisation: Authorisation): Result<CredentialAccount> {
  let value: AuthorisationValue;
  try {
    value = decodeAuthorisation(authorisation);
  } catch (error) {
    return err("ERR-InvalidAuthorisation", `malformed authorisation: ${String(error)}`);
  }
  switch (value.kind) {
    case "p256":
      try {
        return ok(p256Account(value));
      } catch {
        return err("ERR-InvalidAuthorisation", "not a compressed P-256 public key");
      }
    case "passWebAuthn":
      return ok(webAuthnAccount(value.assertion.meta.user_id, value.deviceId));
    default:
      return err("ERR-InvalidAuthorisation", "unknown credential kind");
  }
}

/**
 * Whether `authorisation` over `payload` was produced by the credential
 * `registration` registered (`Profile.verify`, `REQ-SDK-4`). Credentials of
 * different kinds never verify each other.
 */
export function verify(
  registration: Registration,
  payload: Uint8Array,
  authorisation: Authorisation,
  config: CredentialConfig,
): boolean {
  let reg: RegistrationValue;
  let auth: AuthorisationValue;
  try {
    reg = decodeRegistration(registration);
    auth = decodeAuthorisation(authorisation);
  } catch {
    return false;
  }
  if (reg.kind === "p256" && auth.kind === "p256") return verifyP256(reg, payload, auth);
  if (reg.kind === "passWebAuthn" && auth.kind === "passWebAuthn") {
    return checkWebAuthnAssertion(reg, payload, auth, config) === null;
  }
  return false;
}

export { KREIVO_AUTHORITY_ID };
