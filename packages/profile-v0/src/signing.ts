// What a credential signs, separated by domain (features/003-profile-v0/plan.md
// §5.7, rulings 1 and 3).
//
//   command payload        "ticketto/v0/command" ‖ command bytes
//   pass payload           "ticketto/v0/pass"    ‖ access pass bytes
//   registration challenge BLAKE2b-256("ticketto/v0/registration" ‖ account)
//
// Every credential kind hashes the payload it is given: a WebAuthn challenge is
// `BLAKE2b-256(payload)`, and a `p256` key signs the same digest. The tag is part
// of the payload rather than an argument to `Signer.sign` or `Profile.verify`,
// neither of which carries a domain: so `Profile.encodeCommand` and
// `Profile.encodePass` return the tagged payloads, and a signature over a
// command can never verify as a signature over a pass, or the other way round.
// Neither tag is a prefix of the other.
//
// The command and pass bytes themselves are unchanged: `encodeCommand` and
// `encodePass` still return them, without a tag.

import type { AccountId, Command } from "@ticketto/sdk";
import { ascii, concatBytes, fromHex } from "./bytes.js";
import { encodeCommand } from "./codec/command.js";
import { blake2b256 } from "./derive.js";

/** The domain tag of what a command's signer authorises. */
export const COMMAND_SIGNING_TAG: Uint8Array = ascii("ticketto/v0/command");

/** The domain tag of what an access pass's signer authorises. */
export const PASS_SIGNING_TAG: Uint8Array = ascii("ticketto/v0/pass");

/** The domain tag of a `pass-webauthn` registration's challenge. */
export const REGISTRATION_CHALLENGE_TAG: Uint8Array = ascii("ticketto/v0/registration");

/** The bytes a signer authorises for `command` (`Profile.encodeCommand`). */
export function commandSigningPayload(command: Command): Uint8Array {
  return concatBytes(COMMAND_SIGNING_TAG, encodeCommand(command));
}

/**
 * The challenge a `pass-webauthn` registration for `account` must carry:
 * `BLAKE2b-256("ticketto/v0/registration" ‖ account)`. It binds the registration
 * to the account it names.
 */
export function registrationChallenge(account: AccountId): Uint8Array {
  return blake2b256(concatBytes(REGISTRATION_CHALLENGE_TAG, fromHex(account, 32)));
}
