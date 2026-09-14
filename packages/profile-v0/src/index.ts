// @ticketto/profile-v0 — the V0 cryptographic profile (C2, REQ-CP-1).
// Design: features/003-profile-v0/plan.md in KippuRocks/kippu-docs.

// Not `export * as codecs`: React Native's Babel preset cannot transform it.
import * as codecs from "./codec/identity.js";

export { COMMAND_INDEX, decodeCommand, encodeCommand } from "./codec/command.js";
export { DecodeError, FORMAT_VERSION } from "./codec/scale.js";
export {
  type AuthorisationValue,
  accountOf,
  CREDENTIAL_KIND_INDEX,
  decodeAuthorisation,
  decodeRegistration,
  encodeAuthorisation,
  encodeRegistration,
  type RegistrationValue,
  registrationAccount,
  verify,
} from "./credential/credential.js";
export {
  normaliseP256Signature,
  P256_SIGNATURE_LENGTH,
  type P256Signed,
  p256AuthorisationDigest,
  p256RegistrationDigest,
} from "./credential/p256.js";
export {
  blake2b256,
  deviceId,
  eventId,
  hashedUserId,
  holderAccountFromHashedUserId,
  holderAccountId,
  p256AccountId,
  ticketId,
} from "./derive.js";
export { codecs };

export const packageName = "@ticketto/profile-v0";
