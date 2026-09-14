// Canonical framing of a signed input — a signed command or a signed access
// pass — as the log and the wire protocol carry it (REQ-CP-1: the canonical
// representation of anything authorised).
//
//   SignedInput = version u8, kind u8, payload Vec<u8>, authorisation Vec<u8>
//
// | kind | input       | payload                               |
// |------|-------------|---------------------------------------|
// | 0    | command     | the command bytes (`encodeCommand`)   |
// | 1    | access pass | the access pass bytes (`encodePass`)  |
//
// The payload is the untagged canonical encoding, not the signing payload; the
// authorisation is the profile's `version ‖ kind ‖ body`, carried opaque here.
// Decoding is strict: an unknown version or kind, a payload that is not
// canonical, or a trailing byte is refused. This is not the presented form of a
// pass at the gate, which `encodeSignedPass` produces.

import type {
  AccessPass,
  Authorisation,
  Command,
  Result,
  SignedAccessPass,
  SignedCommand,
} from "@ticketto/sdk";
import { type Codec, Struct, u8 } from "scale-ts";
import { decodeCommand, encodeCommand } from "./codec/command.js";
import { boundedBytes, DecodeError, decodeVersioned, encodeVersioned } from "./codec/scale.js";
import { decodePassBytes, encodePass } from "./pass.js";
import { err, ok } from "./result.js";

/** Wire index of each signed input kind. Part of `C2`. */
export const SIGNED_INPUT_KIND_INDEX = { command: 0, accessPass: 1 } as const;

interface Frame {
  readonly kind: number;
  readonly payload: Uint8Array;
  readonly authorisation: Uint8Array;
}

const frameCodec: Codec<Frame> = Struct({
  kind: u8,
  payload: boundedBytes,
  authorisation: boundedBytes,
});

function decodeFrame(bytes: Uint8Array, kind: number): Frame {
  const frame = decodeVersioned(frameCodec, bytes);
  if (frame.kind !== kind)
    throw new DecodeError(`signed input kind ${frame.kind}, expected ${kind}`);
  return frame;
}

/** The canonical framing of a signed command. */
export function encodeSignedCommand(signed: SignedCommand): Uint8Array {
  return encodeVersioned(frameCodec, {
    kind: SIGNED_INPUT_KIND_INDEX.command,
    payload: encodeCommand(signed.command),
    authorisation: signed.authorisation,
  });
}

/** A signed command from its framing. Anything else fails with `ERR-InvalidAuthorisation`. */
export function decodeSignedCommand(bytes: Uint8Array): Result<SignedCommand> {
  try {
    const frame = decodeFrame(bytes, SIGNED_INPUT_KIND_INDEX.command);
    const command: Command = decodeCommand(frame.payload);
    return ok({ command, authorisation: frame.authorisation as Authorisation });
  } catch (error) {
    return err("ERR-InvalidAuthorisation", `malformed signed command: ${String(error)}`);
  }
}

/** The canonical framing of a signed access pass. */
export function encodeSignedAccessPass(signed: SignedAccessPass): Uint8Array {
  return encodeVersioned(frameCodec, {
    kind: SIGNED_INPUT_KIND_INDEX.accessPass,
    payload: encodePass(signed.pass),
    authorisation: signed.authorisation,
  });
}

/** A signed access pass from its framing. Anything else fails with `ERR-InvalidPass`. */
export function decodeSignedAccessPass(bytes: Uint8Array): Result<SignedAccessPass> {
  try {
    const frame = decodeFrame(bytes, SIGNED_INPUT_KIND_INDEX.accessPass);
    const pass: AccessPass = decodePassBytes(frame.payload);
    return ok({ pass, authorisation: frame.authorisation as Authorisation });
  } catch (error) {
    return err("ERR-InvalidPass", `malformed signed access pass: ${String(error)}`);
  }
}
