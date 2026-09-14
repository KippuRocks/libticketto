// Proof of control (features/003-profile-v0/plan.md §5.4a; REQ-SP-4, REQ-CP-6).
//
//   ProofOfControl = "ticketto/v0/proof-of-control" ‖ SCALE(audience Vec<u8>,
//                    nonce [u8;32], expiresAt u64, account [u8;32])
//
// A holder proves to a verifier other than the ledger — `kippu-api` linking a
// holder to an account (F-020 §5.1) — that they control an account. The payload
// is produced here, like command and pass signing payloads, and signed by the
// holder's `Signer`. Its domain tag keeps it from ever verifying as a command or
// a pass, and a command or pass signature from ever verifying as it: none of
// the three tags is a prefix of another.
//
// The profile does not know whether a registration is on the ledger. The
// verifier must read it from the ledger (`getCredential`, F-002 §5.5): a
// registration from any other source proves nothing, because one can be built
// for any account whose derivation inputs are public (REQ-CP-6).

import type { AccountId, Authorisation, Registration, Signer, Timestamp } from "@ticketto/sdk";
import { type Codec, Struct } from "scale-ts";
import { ascii, concatBytes } from "./bytes.js";
import { accountId } from "./codec/identity.js";
import { boundedBytes, fixedBytes, timestamp } from "./codec/scale.js";
import {
  accountOf,
  type CredentialConfig,
  registrationAccount,
  verify,
} from "./credential/credential.js";

/** The domain tag of a proof of control's signing payload. */
export const PROOF_OF_CONTROL_TAG: Uint8Array = ascii("ticketto/v0/proof-of-control");

/** Bytes in a proof-of-control nonce. */
export const PROOF_OF_CONTROL_NONCE_LENGTH = 32;

/** What a verifier asks a holder to prove control over, and for whom. */
export interface ProofOfControlChallenge {
  /** Who the proof is for, so that a proof given to one verifier is useless to another. */
  readonly audience: Uint8Array;
  /** 32 fresh bytes chosen by the verifier, which consumes each once. */
  readonly nonce: Uint8Array;
  /** The proof is valid strictly before this time. */
  readonly expiresAt: Timestamp;
  /** The account whose control is proven. */
  readonly account: AccountId;
}

const challengeCodec: Codec<ProofOfControlChallenge> = Struct({
  audience: boundedBytes,
  nonce: fixedBytes(PROOF_OF_CONTROL_NONCE_LENGTH),
  expiresAt: timestamp,
  account: accountId,
});

/**
 * The bytes a holder signs to prove control:
 * `"ticketto/v0/proof-of-control" ‖ SCALE(audience, nonce, expiresAt, account)`.
 * Throws `TypeError` for a challenge that cannot be encoded — a nonce that is
 * not 32 bytes, say.
 */
export function proofOfControlSigningPayload(challenge: ProofOfControlChallenge): Uint8Array {
  return concatBytes(PROOF_OF_CONTROL_TAG, challengeCodec.enc(challenge));
}

/** Signs `challenge` with the holder's `signer`, which must be the challenge's account's. */
export async function signProofOfControl(
  challenge: ProofOfControlChallenge,
  signer: Signer,
): Promise<Authorisation> {
  if (signer.account !== challenge.account) {
    throw new TypeError("a proof of control is signed by a credential of the account it names");
  }
  return signer.sign(proofOfControlSigningPayload(challenge));
}

/** Which check of `verifyProofOfControl` a proof failed, in the order they run. */
export type ProofOfControlFailure =
  /** The registration does not derive the challenge's account (or does not decode). */
  | "account"
  /** The authorisation does not come from the registration's credential. */
  | "credential"
  /** The authorisation does not verify over the challenge's signing payload. */
  | "signature"
  /** The proof's expiry has passed. */
  | "expired";

/** The outcome of verifying a proof of control. */
export type ProofOfControlVerdict =
  | { readonly ok: true; readonly account: AccountId }
  | { readonly ok: false; readonly failure: ProofOfControlFailure };

/**
 * Verifies a proof of control, checking in order (plan §5.4a):
 *
 * 1. `registration` derives the challenge's account;
 * 2. the authorisation's credential is the registration's;
 * 3. the authorisation verifies over the challenge's signing payload under the
 *    registration's key — for a passkey, with the configured holder RP id,
 *    user presence and user verification;
 * 4. `now` is before `expiresAt`.
 *
 * A proof is not a ledger operation, so a failure names the check it failed
 * rather than an error of SPEC.md §10. `registration` must come from the ledger
 * (`getCredential`); whether the nonce was already used is the verifier's to
 * track. Throws `TypeError` for a challenge that cannot be encoded.
 */
export function verifyProofOfControl(
  challenge: ProofOfControlChallenge,
  authorisation: Authorisation,
  registration: Registration,
  now: Timestamp,
  config: CredentialConfig,
): ProofOfControlVerdict {
  const payload = proofOfControlSigningPayload(challenge);
  const registered = registrationAccount(registration);
  if (!registered.ok || registered.value.account !== challenge.account) {
    return { ok: false, failure: "account" };
  }
  const claimed = accountOf(authorisation);
  if (
    !claimed.ok ||
    claimed.value.account !== registered.value.account ||
    claimed.value.credential !== registered.value.credential
  ) {
    return { ok: false, failure: "credential" };
  }
  if (!verify(registration, payload, authorisation, config)) {
    return { ok: false, failure: "signature" };
  }
  if (!(now < challenge.expiresAt)) return { ok: false, failure: "expired" };
  return { ok: true, account: challenge.account };
}
