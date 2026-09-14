// Identifier derivation (features/003-profile-v0/plan.md §5.2, §5.3; AD-12).
//
// Every Ticketto-defined hash is BLAKE2b-256 over an ASCII domain tag followed
// by its input. The holder account is the exception: it must equal what Kreivo
// derives for a Kreivo Pass account (`kreivoPassDefaultAddressGenerator` in
// virto-network/papi-signers), so that holders reach Kreivo without
// re-attestation (REQ-MG-6).

import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { AccountId, EventId, Placement, TicketId, ZoneId } from "@ticketto/sdk";
import { ascii, concatBytes, fromHex, toHex } from "./bytes.js";
import {
  eventId as eventIdCodec,
  placement as placementCodec,
  zoneId as zoneIdCodec,
} from "./codec/identity.js";

/** Bytes in every derived identifier and hash. */
export const HASH_LENGTH = 32;

/** BLAKE2b with a 256-bit output. */
export function blake2b256(input: Uint8Array): Uint8Array {
  return blake2b(input, { dkLen: HASH_LENGTH });
}

export const TAGS = {
  event: ascii("ticketto/v0/event"),
  ticket: ascii("ticketto/v0/ticket"),
  p256Account: ascii("ticketto/v0/account/p256"),
} as const;

const USER_ID = /^[0-9a-f]{64}$/;

/**
 * `SHA-256(userId)` over the UTF-8 of the lower-case hex string, as
 * `WebAuthn.getHashedUserId` computes it.
 *
 * `userId` must be 32 random bytes as lower-case hex (plan §5.2). Anything else
 * — an email, a phone number — would make the account guessable, and squattable
 * by whoever registers a device first; this function refuses it.
 */
export function hashedUserId(userId: string): Uint8Array {
  if (typeof userId !== "string" || !USER_ID.test(userId)) {
    throw new TypeError("a user id is 32 random bytes as lower-case hex");
  }
  return sha256(ascii(userId));
}

/**
 * A holder's account from their hashed user id: `BLAKE2b-256(0³² ‖ hashedUserId)`,
 * Kreivo's `kreivoPassDefaultAddressGenerator`. Not domain-separated, by design.
 */
export function holderAccountFromHashedUserId(hashed: Uint8Array): AccountId {
  if (hashed.length !== HASH_LENGTH) throw new TypeError("a hashed user id is 32 bytes");
  return toHex(blake2b256(concatBytes(new Uint8Array(HASH_LENGTH), hashed))) as AccountId;
}

/** A holder's account from their user id (plan §5.2). */
export function holderAccountId(userId: string): AccountId {
  return holderAccountFromHashedUserId(hashedUserId(userId));
}

/** Bytes in a compressed P-256 public key. */
export const P256_PUBLIC_KEY_LENGTH = 33;

/** A `p256` account: `BLAKE2b-256("ticketto/v0/account/p256" ‖ compressed public key)`. */
export function p256AccountId(compressedPublicKey: Uint8Array): AccountId {
  const prefix = compressedPublicKey[0];
  if (compressedPublicKey.length !== P256_PUBLIC_KEY_LENGTH || (prefix !== 2 && prefix !== 3)) {
    throw new TypeError("expected a compressed P-256 public key");
  }
  return toHex(blake2b256(concatBytes(TAGS.p256Account, compressedPublicKey))) as AccountId;
}

/** A WebAuthn device id: `BLAKE2b-256(credential rawId)`, as `WebAuthn.getDeviceId`. */
export function deviceId(rawId: Uint8Array): Uint8Array {
  return blake2b256(rawId);
}

/** `BLAKE2b-256("ticketto/v0/event" ‖ creator ‖ salt)` (`REQ-EV-9`). */
export function eventId(creator: AccountId, salt: Uint8Array): EventId {
  return toHex(blake2b256(concatBytes(TAGS.event, fromHex(creator, HASH_LENGTH), salt))) as EventId;
}

/**
 * `BLAKE2b-256("ticketto/v0/ticket" ‖ SCALE(eventId, zoneId, placement))`.
 * Determined solely by event, zone and placement (`REQ-ID-1`, `INV-13`).
 */
export function ticketId(event: EventId, zone: ZoneId, placement: Placement): TicketId {
  return toHex(
    blake2b256(
      concatBytes(
        TAGS.ticket,
        eventIdCodec.enc(event),
        zoneIdCodec.enc(zone),
        placementCodec.enc(placement),
      ),
    ),
  ) as TicketId;
}
