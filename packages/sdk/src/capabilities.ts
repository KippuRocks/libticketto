// The interfaces the SDK consumes — features/002-sdk/plan.md §5.7.
//
// Credentials and encodings stay behind `Profile` and `Signer`; what crosses
// the surface is opaque bytes. Nothing here names a scheme, a key length or an
// encoding (REQ-SDK-4, REQ-CP-2): the profile in force is supplied, exactly as
// a backend is.

import type { AccessPass, Command, SignedAccessPass } from "./commands.js";
import type { Authorisation, CredentialId, Registration, Sponsorship } from "./credentials.js";
import type { Placement } from "./domain.js";
import type { Result } from "./errors.js";
import type { AccountId, EventId, TicketId, ZoneId } from "./identifiers.js";

/** A command with the authorisation of the account that signed it. */
export interface SignedCommand {
  readonly command: Command;
  readonly authorisation: Authorisation;
}

/** The account an authorisation or registration speaks for, and the credential that produced it. */
export interface CredentialAccount {
  readonly account: AccountId;
  readonly credential: CredentialId;
}

/**
 * The cryptographic profile (`C2`, `REQ-CP-1`): identity derivation, canonical
 * encoding, and verification. Implemented by `F-003`.
 */
export interface Profile {
  /** The id of an event created by `creator` with a caller-chosen `salt` (`REQ-EV-9`). */
  eventId(creator: AccountId, salt: Uint8Array): EventId;
  /** The id of the ticket at `placement` in `zone` of `event` (`REQ-ID-1`). */
  ticketId(event: EventId, zone: ZoneId, placement: Placement): TicketId;
  /** The canonical bytes a signer authorises for `command`. */
  encodeCommand(command: Command): Uint8Array;
  /** The account, and its credential, an authorisation claims to come from. Does not verify it. */
  accountOf(authorisation: Authorisation): Result<CredentialAccount>;
  /** The account, and the credential, a registration registers (`REQ-CP-6`). */
  registrationAccount(registration: Registration): Result<CredentialAccount>;
  /** Whether `authorisation` over `payload` was produced by the credential `registration` registered. */
  verify(registration: Registration, payload: Uint8Array, authorisation: Authorisation): boolean;
  /** The canonical bytes a holder authorises for `pass`. */
  encodePass(pass: AccessPass): Uint8Array;
  /** A signed pass from its presented bytes — for example, a scanned code. */
  decodePass(bytes: Uint8Array): Result<SignedAccessPass>;
}

/** Authorises payloads for one account: a holder's credential, or organiser authority (`REQ-OA-1`). */
export interface Signer {
  readonly account: AccountId;
  sign(payload: Uint8Array): Promise<Authorisation>;
}

/**
 * Relays a signed command or a signed access pass and bears whatever cost the
 * ledger imposes on it (`REQ-SP-1`, `AD-18` A). Holds no right to act for
 * anyone (`REQ-SP-2`).
 */
export interface Sponsor {
  sponsor(input: SignedCommand | SignedAccessPass): Promise<Result<Sponsorship>>;
}
