// Access passes (SPEC.md §5.3, REQ-AP-1–REQ-AP-5; AD-13;
// features/003-profile-v0/plan.md §5.4).
//
//   AccessPass       = version u8, ticket [u8;32], holder [u8;32], passId [u8;16],
//                      notBefore u64, notAfter u64                     (97 bytes)
//   SignedAccessPass = pass (97 bytes), authorisation Vec<u8>
//
// Production is a pure function plus a `Signer`: nothing touches a network
// (NFR-3). Verification checks the signature and the window against a supplied
// clock. Whether the signer is the ticket's *current* holder is not checked
// here: that needs ledger state, and is the rules' (REQ-AP-1).

import { randomBytes } from "@noble/hashes/utils.js";
import type {
  AccessPass,
  AccountId,
  Authorisation,
  PassId,
  Registration,
  Result,
  SignedAccessPass,
  Signer,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";
import { type Codec, createCodec, createDecoder, Struct, u8 } from "scale-ts";
import { concatBytes, toHex } from "./bytes.js";
import { accountId, passId, RANDOM_ID_LENGTH, ticketId } from "./codec/identity.js";
import {
  boundedBytes,
  DecodeError,
  decodeExact,
  FORMAT_VERSION,
  timestamp,
} from "./codec/scale.js";
import {
  accountOf,
  type CredentialConfig,
  registrationAccount,
  verify,
} from "./credential/credential.js";
import { err, ok } from "./result.js";
import { PASS_SIGNING_TAG } from "./signing.js";

/** Bytes in an encoded access pass, format version included. */
export const PASS_LENGTH = 97;

/** `NFR-5`'s default validity window, in milliseconds. The organiser may change it per event. */
export const DEFAULT_PASS_WINDOW = 60_000;

const passBody: Codec<AccessPass> = Struct({
  ticket: ticketId,
  holder: accountId,
  id: passId,
  notBefore: timestamp,
  notAfter: timestamp,
});

/** An access pass, format version included. */
const passCodec: Codec<AccessPass> = createCodec(
  (pass: AccessPass) => concatBytes(Uint8Array.of(FORMAT_VERSION), passBody.enc(pass)),
  createDecoder((input) => {
    const version = u8.dec(input);
    if (version !== FORMAT_VERSION) throw new DecodeError(`unsupported format version ${version}`);
    return passBody.dec(input);
  }),
);

const signedPassCodec: Codec<SignedAccessPass> = createCodec(
  (signed: SignedAccessPass) =>
    concatBytes(passCodec.enc(signed.pass), boundedBytes.enc(signed.authorisation)),
  createDecoder((input) => ({
    pass: passCodec.dec(input),
    authorisation: boundedBytes.dec(input) as Authorisation,
  })),
);

/** The canonical bytes of `pass`: 97 bytes, format version included. */
export function encodePass(pass: AccessPass): Uint8Array {
  return passCodec.enc(pass);
}

/**
 * The bytes a holder authorises for `pass` (`Profile.encodePass`):
 * `"ticketto/v0/pass" ‖ encodePass(pass)`, so that a pass signature never
 * verifies as a command signature (plan §5.7, ruling 3).
 */
export function passSigningPayload(pass: AccessPass): Uint8Array {
  return concatBytes(PASS_SIGNING_TAG, encodePass(pass));
}

/** The access pass `bytes` canonically encode. Throws `DecodeError` otherwise. */
export function decodePassBytes(bytes: Uint8Array): AccessPass {
  return decodeExact(passCodec, bytes);
}

/** A signed pass as presented — for example, in a QR code. */
export function encodeSignedPass(signed: SignedAccessPass): Uint8Array {
  return signedPassCodec.enc(signed);
}

/**
 * A signed pass from its presented bytes (`Profile.decodePass`). Anything but
 * the canonical encoding fails with `ERR-InvalidPass`.
 */
export function decodePass(bytes: Uint8Array): Result<SignedAccessPass> {
  try {
    return ok(decodeExact(signedPassCodec, bytes));
  } catch (error) {
    return err("ERR-InvalidPass", `malformed pass: ${String(error)}`);
  }
}

/** What a holder's client supplies to produce a pass. */
export interface PassRequest {
  readonly ticket: TicketId;
  readonly holder: AccountId;
  /** Start of the window, normally the device's current time. */
  readonly notBefore: Timestamp;
  /** Length of the window in milliseconds. Defaults to `NFR-5`'s 60 s. */
  readonly window?: number;
  /** A 128-bit pass id (`REQ-AP-4`). Defaults to fresh random bytes. */
  readonly id?: PassId;
}

/**
 * Produces a signed pass for `request` with the holder's `signer`. No network is
 * involved (`NFR-3`, `REQ-AP-5`). The default pass id uses
 * `crypto.getRandomValues`, which a React Native app must provide.
 */
export async function producePass(request: PassRequest, signer: Signer): Promise<SignedAccessPass> {
  if (signer.account !== request.holder) {
    throw new TypeError("a pass is signed by its holder's own credential (REQ-AP-1)");
  }
  const window = request.window ?? DEFAULT_PASS_WINDOW;
  if (!Number.isSafeInteger(window) || window < 0) {
    throw new TypeError("a pass window is a non-negative number of milliseconds");
  }
  const pass: AccessPass = {
    ticket: request.ticket,
    holder: request.holder,
    id: request.id ?? (toHex(randomBytes(RANDOM_ID_LENGTH)) as PassId),
    notBefore: request.notBefore,
    notAfter: request.notBefore + window,
  };
  return { pass, authorisation: await signer.sign(passSigningPayload(pass)) };
}

/** A source of the current time, in milliseconds since the Unix epoch. */
export interface Clock {
  now(): Timestamp;
}

/**
 * Verifies a signed pass's signature and window.
 *
 * - `ERR-InvalidPass` when the authorisation does not come from the pass's
 *   `holder` account (`AC-E1.2`), when `registration` is not a credential of that
 *   account, or when the signature does not verify against it.
 * - `ERR-PassExpired` when `clock.now()` is outside `[notBefore, notAfter]`
 *   (`REQ-AP-3`).
 *
 * `registration` is the one registered for the credential `accountOf` names;
 * looking it up, and checking that `holder` still holds the ticket, are the
 * rules' (`REQ-AP-1`).
 */
export function verifyPass(
  signed: SignedAccessPass,
  registration: Registration,
  clock: Clock,
  config: CredentialConfig,
): Result<AccessPass> {
  const { pass, authorisation } = signed;
  const claimed = accountOf(authorisation);
  if (!claimed.ok || claimed.value.account !== pass.holder) {
    return err("ERR-InvalidPass", "not signed by the pass's holder");
  }
  const registered = registrationAccount(registration);
  if (
    !registered.ok ||
    registered.value.account !== claimed.value.account ||
    registered.value.credential !== claimed.value.credential
  ) {
    return err("ERR-InvalidPass", "the registration is not the signing credential");
  }
  let payload: Uint8Array;
  try {
    payload = passSigningPayload(pass);
  } catch {
    return err("ERR-InvalidPass", "malformed pass");
  }
  if (!verify(registration, payload, authorisation, config)) {
    return err("ERR-InvalidPass", "the signature does not verify");
  }
  const now = clock.now();
  if (now < pass.notBefore || now > pass.notAfter) {
    return err("ERR-PassExpired", "outside the pass's validity window");
  }
  return ok(pass);
}
