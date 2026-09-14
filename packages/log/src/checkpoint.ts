// Checkpoints (C7; features/006-log-and-export/plan.md §5.3, AD-16, REQ-TM-3).
//
//   Checkpoint      = version u8, sequence u64, headHash [u8;32], issuedAt u64,
//                     authorisation Vec<u8>
//   signing payload = "ticketto/v0/checkpoint" ‖ version u8 ‖ sequence u64 ‖
//                     headHash [u8;32] ‖ issuedAt u64
//
// A checkpoint states that the record at `sequence` has hash `headHash`. It is
// signed through a `Signer` holding the publication key, a `p256` credential
// (F-003), and verified through the profile. A party holding a checkpoint
// checks that the log it is later shown still has that hash at that sequence:
// a rewrite of anything at or before it shows as a mismatch there, without
// Kippu's cooperation (REQ-TM-3).
//
// Publishing checkpoints is `ticketto-offchain`'s (F-010); where the
// publication key is kept is decided there too.

import { decodeAuthorisation, decodeRegistration, verify } from "@ticketto/profile-v0";
import type { Authorisation, Registration, Signer, Timestamp } from "@ticketto/sdk";
import { ascii, concatBytes, fromHex, toHex } from "./bytes.js";
import type { ChainHead } from "./chain.js";
import { HASH_LENGTH } from "./record.js";
import { LogDecodeError, Reader, Writer } from "./scale.js";

/** The format version a checkpoint starts with. */
export const CHECKPOINT_VERSION = 0;

/** The domain-separation tag of a checkpoint's signing payload. */
export const CHECKPOINT_SIGNING_TAG = "ticketto/v0/checkpoint";

/** What a checkpoint states, before it is signed. */
export interface CheckpointStatement {
  /** The sequence of the last record the checkpoint covers. */
  readonly sequence: number;
  /** That record's hash, as lower-case hex. */
  readonly headHash: string;
  /** When the checkpoint was issued, in milliseconds since the Unix epoch. */
  readonly issuedAt: Timestamp;
}

/** A signed checkpoint. */
export interface Checkpoint extends CheckpointStatement {
  /** The publication key's authorisation over the signing payload. */
  readonly authorisation: Authorisation;
}

function writeStatement(writer: Writer, statement: CheckpointStatement): Writer {
  return writer
    .u8(CHECKPOINT_VERSION)
    .u64(statement.sequence, "sequence")
    .fixed(fromHex(statement.headHash), HASH_LENGTH, "headHash")
    .u64(statement.issuedAt, "issuedAt");
}

const TAG_BYTES = ascii(CHECKPOINT_SIGNING_TAG);

/** The bytes the publication key signs for `statement`. */
export function checkpointSigningPayload(statement: CheckpointStatement): Uint8Array {
  return concatBytes(TAG_BYTES, writeStatement(new Writer(), statement).finish());
}

/** The statement a checkpoint of the chain at `head` makes. Throws for an empty log. */
export function statementFor(head: ChainHead, issuedAt: Timestamp): CheckpointStatement {
  if (head.next === 0) throw new TypeError("an empty log has no record to checkpoint");
  return { sequence: head.next - 1, headHash: head.hash, issuedAt };
}

/** Signs `statement` with the publication key's `signer`. */
export async function signCheckpoint(
  statement: CheckpointStatement,
  signer: Signer,
): Promise<Checkpoint> {
  const payload = checkpointSigningPayload(statement);
  const { sequence, headHash, issuedAt } = statement;
  return { sequence, headHash, issuedAt, authorisation: await signer.sign(payload) };
}

/** The canonical bytes of a signed checkpoint. */
export function encodeCheckpoint(checkpoint: Checkpoint): Uint8Array {
  return writeStatement(new Writer(), checkpoint)
    .bytes(checkpoint.authorisation, "authorisation")
    .finish();
}

/** The checkpoint `bytes` canonically encode. Throws `LogDecodeError` for anything else. */
export function decodeCheckpoint(bytes: Uint8Array): Checkpoint {
  const reader = new Reader(bytes);
  const version = reader.u8();
  if (version !== CHECKPOINT_VERSION) {
    throw new LogDecodeError(`unsupported checkpoint version ${version}`);
  }
  const sequence = reader.u64();
  const headHash = toHex(reader.fixed(HASH_LENGTH));
  const issuedAt = reader.u64();
  const authorisation = reader.bytes() as Authorisation;
  reader.end();
  return { sequence, headHash, issuedAt, authorisation };
}

/**
 * Whether `checkpoint` is signed by the publication key `publication` registers.
 * Both must be of the profile's `p256` kind: a checkpoint signed by any other
 * kind of credential is refused.
 */
export function verifyCheckpoint(checkpoint: Checkpoint, publication: Registration): boolean {
  let payload: Uint8Array;
  try {
    if (decodeRegistration(publication).kind !== "p256") return false;
    if (decodeAuthorisation(checkpoint.authorisation).kind !== "p256") return false;
    payload = checkpointSigningPayload(checkpoint);
  } catch {
    return false;
  }
  // The WebAuthn configuration plays no part in verifying a `p256` credential.
  return verify(publication, payload, checkpoint.authorisation, { rpId: "" });
}
