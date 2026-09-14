// The log record (C7; features/006-log-and-export/plan.md §5.1, AD-16, AD-11).
//
//   LogRecord = version u8, sequence u64,
//               event Option<(id [u8;32], eventSequence u64)>,
//               recordedAt u64, input Input, presentedAt Option<u64>,
//               prevHash [u8;32]
//   Input     = 0u8, command Vec<u8>, authorisation Vec<u8>     a signed command
//             | 1u8, pass [u8;97], authorisation Vec<u8>        a signed access pass
//   hash      = BLAKE2b-256("ticketto/v0/log" ‖ LogRecord)
//
// `command` and `pass` are the profile's canonical bytes — exactly what the
// signer authorised — so a third party re-verifies an authorisation against the
// bytes in the record, not against a re-encoding (REQ-SDK-5, REQ-TM-3). The
// signed-pass variant is, byte for byte, the profile's presented pass.
//
// There is no `effects` field in V0: the input, its place in the order,
// `recordedAt` and `presentedAt` determine the change under a rules version
// (plan §5.1). The event reference is optional because some inputs — registering
// a credential — belong to no event, as in the SDK's `LogRecord`.

import {
  blake2b256,
  DecodeError,
  decodeCommand,
  decodePass,
  encodeCommand,
  encodeSignedPass,
  PASS_LENGTH,
} from "@ticketto/profile-v0";
import type {
  Authorisation,
  EventId,
  SignedAccessPass,
  SignedCommand,
  Timestamp,
} from "@ticketto/sdk";
import { checkRecordContent } from "./allow-list.js";
import { ascii, concatBytes, fromHex, toHex } from "./bytes.js";
import { LogDecodeError, Reader, Writer } from "./scale.js";

/** The format version a record starts with. A later record format takes the next value. */
export const RECORD_VERSION = 0;

/** The domain-separation tag of a record hash. */
export const RECORD_HASH_TAG = "ticketto/v0/log";

/** Bytes in a record hash, an event id, and a `prevHash`. */
export const HASH_LENGTH = 32;

/** The `prevHash` of the first record in a log: 32 zero bytes, as hex. */
export const GENESIS_HASH = "00".repeat(HASH_LENGTH);

const INPUT_COMMAND = 0;
const INPUT_PASS = 1;

/** What a record carries: the write as submitted, with its authorisation. */
export type LogInput = SignedCommand | SignedAccessPass;

/** A record's place in its event's own sequence (`REQ-MG-4`). */
export interface EventReference {
  readonly id: EventId;
  /** 0 for the event's first record, then one more per record. */
  readonly sequence: number;
}

/** One record of the published log, as encoded (`C7`). */
export interface ChainedRecord {
  /** Position in the deployment's total order (`INV-15`): 0 for the first record. */
  readonly sequence: number;
  /** The event the input concerns, and the record's place in that event's sequence. */
  readonly event: EventReference | null;
  /** When the ledger recorded the input, by its clock. */
  readonly recordedAt: Timestamp;
  readonly input: LogInput;
  /** When a pass was presented, as claimed by its submitter; `null` when none was claimed. */
  readonly presentedAt: Timestamp | null;
  /** The previous record's hash, as lower-case hex; `GENESIS_HASH` for the first record. */
  readonly prevHash: string;
}

function isPass(input: LogInput): input is SignedAccessPass {
  return Object.hasOwn(input, "pass");
}

/**
 * Throws a `TypeError` unless the record names the event its input concerns: a
 * command's own `event`, none for a command without one, and some event for a
 * pass (whose ticket belongs to one).
 */
function checkEventReference(record: ChainedRecord): void {
  const { input, event } = record;
  if (isPass(input)) {
    if (event === null) throw new TypeError("a pass record names the event of its ticket");
    return;
  }
  const command = input.command;
  const own = Object.hasOwn(command, "event") ? (command as { event: EventId }).event : null;
  if (own === null && event !== null) {
    throw new TypeError(`a ${command.kind} record names no event`);
  }
  if (own !== null && event?.id !== own) {
    throw new TypeError(`a ${command.kind} record names the command's own event`);
  }
}

/**
 * The canonical bytes of `record`. Throws `LogContentError` for any field outside
 * the `NFR-6` allow-list, and a `TypeError` for any value that cannot be encoded.
 */
export function encodeRecord(record: ChainedRecord): Uint8Array {
  checkRecordContent(record);
  checkEventReference(record);
  const writer = new Writer()
    .u8(RECORD_VERSION)
    .u64(record.sequence, "sequence")
    .option(record.event, (w, event) => {
      w.fixed(fromHex(event.id), HASH_LENGTH, "event.id").u64(event.sequence, "event.sequence");
    })
    .u64(record.recordedAt, "recordedAt");
  const { input } = record;
  if (isPass(input)) {
    // The profile's presented pass: pass [u8;97] ‖ authorisation Vec<u8>.
    writer.u8(INPUT_PASS);
    writer.raw(encodeSignedPass(input));
  } else {
    writer
      .u8(INPUT_COMMAND)
      .bytes(encodeCommand(input.command), "input.command")
      .bytes(input.authorisation, "input.authorisation");
  }
  return writer
    .option(record.presentedAt, (w, at) => {
      w.u64(at, "presentedAt");
    })
    .fixed(fromHex(record.prevHash), HASH_LENGTH, "prevHash")
    .finish();
}

function decodeInput(reader: Reader): LogInput {
  const kind = reader.u8();
  if (kind === INPUT_COMMAND) {
    const bytes = reader.bytes();
    let command: SignedCommand["command"];
    try {
      command = decodeCommand(bytes);
    } catch (error) {
      if (error instanceof DecodeError) throw new LogDecodeError(`input.command: ${error.message}`);
      throw error;
    }
    return { command, authorisation: reader.bytes() as Authorisation };
  }
  if (kind === INPUT_PASS) {
    const pass = reader.fixed(PASS_LENGTH);
    const authorisation = reader.bytes();
    const decoded = decodePass(concatBytes(pass, new Writer().bytes(authorisation).finish()));
    if (!decoded.ok) throw new LogDecodeError(`input.pass: ${decoded.error.detail ?? "invalid"}`);
    return decoded.value;
  }
  throw new LogDecodeError(`unknown input kind ${kind}`);
}

/** The record `bytes` canonically encode. Throws `LogDecodeError` for anything else. */
export function decodeRecord(bytes: Uint8Array): ChainedRecord {
  const reader = new Reader(bytes);
  const version = reader.u8();
  if (version !== RECORD_VERSION) throw new LogDecodeError(`unsupported record version ${version}`);
  const sequence = reader.u64();
  const event = reader.option((r) => ({
    id: toHex(r.fixed(HASH_LENGTH)) as EventId,
    sequence: r.u64(),
  }));
  const recordedAt = reader.u64();
  const input = decodeInput(reader);
  const presentedAt = reader.option((r) => r.u64());
  const prevHash = toHex(reader.fixed(HASH_LENGTH));
  reader.end();
  const record: ChainedRecord = { sequence, event, recordedAt, input, presentedAt, prevHash };
  try {
    checkEventReference(record);
  } catch (error) {
    throw new LogDecodeError(error instanceof Error ? error.message : String(error));
  }
  return record;
}

const TAG_BYTES = ascii(RECORD_HASH_TAG);

/** `BLAKE2b-256("ticketto/v0/log" ‖ bytes)`, as lower-case hex: the hash of an encoded record. */
export function hashRecordBytes(bytes: Uint8Array): string {
  return toHex(blake2b256(concatBytes(TAG_BYTES, bytes)));
}

/** The hash of `record`: its canonical bytes under the record domain tag. */
export function hashRecord(record: ChainedRecord): string {
  return hashRecordBytes(encodeRecord(record));
}
