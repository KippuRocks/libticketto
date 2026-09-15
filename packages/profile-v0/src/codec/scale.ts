// SCALE building blocks for the V0 profile (AD-11; features/003-profile-v0/plan.md §5.1).
//
// `scale-ts` supplies the encoding. What is added here is what a signed format
// needs and the library leaves to its caller: values are validated before they
// are encoded, and decoding is strict — see `decodeExact`.

import {
  Bytes,
  type Codec,
  compact,
  createCodec,
  createDecoder,
  type Decoder,
  type Encoder,
  enhanceCodec,
  u8,
  u64,
} from "scale-ts";
import { concatBytes, equalBytes, fromHex, toHex } from "../bytes.js";

/**
 * The format version every top-level encoded value of this profile starts with,
 * so that a later profile revision can be told apart on the wire (plan §5.1).
 */
export const FORMAT_VERSION = 0;

/** Raised when bytes are not the canonical encoding of a value of this profile. */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

/**
 * Decodes `bytes` with `codec`, accepting only the canonical encoding: the value
 * must re-encode to exactly `bytes`. That refuses trailing bytes, truncation,
 * non-minimal compact integers, booleans other than 0 and 1, and anything else
 * that would let two byte strings stand for one signed value.
 */
export function decodeExact<T>(codec: Codec<T>, bytes: Uint8Array): T {
  let value: T;
  try {
    // A copy into memory of its own: scale-ts reads from the underlying buffer,
    // ignoring a view's offset. `bytes.slice()` is not enough — on a Node
    // `Buffer`, `slice` returns another view into the same pool.
    value = codec.dec(new Uint8Array(bytes));
  } catch (error) {
    throw new DecodeError(error instanceof Error ? error.message : String(error));
  }
  let reencoded: Uint8Array;
  try {
    reencoded = codec.enc(value);
  } catch (error) {
    throw new DecodeError(error instanceof Error ? error.message : String(error));
  }
  if (!equalBytes(reencoded, bytes)) {
    throw new DecodeError("not the canonical encoding");
  }
  return value;
}

/** `codec`'s encoding, prefixed with the format version (plan §5.1). */
export function encodeVersioned<T>(codec: Codec<T>, value: T): Uint8Array {
  return concatBytes(Uint8Array.of(FORMAT_VERSION), codec.enc(value));
}

/** The value of a versioned encoding; throws `DecodeError` for any other version or form. */
export function decodeVersioned<T>(codec: Codec<T>, bytes: Uint8Array): T {
  if (bytes.length === 0) throw new DecodeError("empty input");
  if (bytes[0] !== FORMAT_VERSION) {
    throw new DecodeError(`unsupported format version ${bytes[0]}`);
  }
  return decodeExact(codec, bytes.subarray(1));
}

/** A fixed-width byte string. */
export function fixedBytes(length: number): Codec<Uint8Array> {
  return enhanceCodec<Uint8Array, Uint8Array>(
    Bytes(length),
    (bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
        throw new TypeError(`expected ${length} bytes`);
      }
      return bytes;
    },
    (bytes) => {
      if (bytes.length !== length) throw new DecodeError(`expected ${length} bytes`);
      return bytes;
    },
  );
}

/** A fixed-width byte string, carried as lower-case hex (a branded identifier). */
export function fixedHex<T extends string>(length: number): Codec<T> {
  return enhanceCodec<Uint8Array, T>(
    fixedBytes(length),
    (hex) => fromHex(hex, length),
    (bytes) => toHex(bytes) as T,
  );
}

/** A length-prefixed byte string, carried as lower-case hex. */
export function variableHex<T extends string>(): Codec<T> {
  return enhanceCodec<Uint8Array, T>(
    boundedBytes,
    (hex) => fromHex(hex),
    (bytes) => toHex(bytes) as T,
  );
}

const lengthPrefixedBytes: Encoder<Uint8Array> = (bytes) =>
  concatBytes(compact.enc(bytes.length), bytes);

/**
 * A length-prefixed byte string whose declared length must fit in what is left
 * of the input, so that a forged length cannot make the decoder allocate.
 */
export const boundedBytes: Codec<Uint8Array> = createCodec(
  (bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("expected bytes");
    return lengthPrefixedBytes(bytes);
  },
  createDecoder((input) => {
    const internal = input as Uint8Array & { i: number };
    const length = toSafeInteger(compact.dec(internal));
    if (length > internal.length - internal.i) throw new DecodeError("length exceeds input");
    // Not `internal.slice`: its species constructor is scale-ts's internal view.
    const out = new Uint8Array(internal.buffer.slice(internal.i, internal.i + length));
    internal.i += length;
    return out;
  }),
);

/** A length-prefixed sequence whose declared length cannot exceed the input left. */
export function boundedVector<T>(inner: Codec<T>): Codec<readonly T[]> {
  const [encodeItem, decodeItem] = inner;
  return createCodec<readonly T[]>(
    (items: readonly T[]) => concatBytes(compact.enc(items.length), ...items.map(encodeItem)),
    createDecoder((input): readonly T[] => {
      const internal = input as Uint8Array & { i: number };
      const length = toSafeInteger(compact.dec(internal));
      // Every item takes at least one byte.
      if (length > internal.length - internal.i) throw new DecodeError("length exceeds input");
      const items: T[] = [];
      for (let n = 0; n < length; n++) items.push((decodeItem as Decoder<T>)(internal));
      return items;
    }),
  );
}

/** An enumeration without payloads, as a one-byte index in the order given. */
export function unitEnum<T extends string>(names: readonly T[]): Codec<T> {
  return createCodec(
    (name: T) => {
      const index = names.indexOf(name);
      if (index < 0) throw new TypeError(`unknown variant ${String(name)}`);
      return u8.enc(index);
    },
    createDecoder((input) => {
      const index = u8.dec(input);
      const name = names[index];
      if (name === undefined) throw new DecodeError(`unknown variant index ${index}`);
      return name;
    }),
  );
}

/** `Option<T>` as `T | null`, the SDK's representation (features/002-sdk/plan.md §5.2). */
export function nullable<T>(inner: Codec<T>): Codec<T | null> {
  const [encodeInner, decodeInner] = inner;
  return createCodec(
    (value: T | null) =>
      value === null ? Uint8Array.of(0) : concatBytes(Uint8Array.of(1), encodeInner(value)),
    createDecoder((input) => {
      const tag = u8.dec(input);
      if (tag === 0) return null;
      if (tag === 1) return decodeInner(input);
      throw new DecodeError(`invalid option tag ${tag}`);
    }),
  );
}

function toSafeInteger(value: number | bigint): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || BigInt(n) !== BigInt(value)) {
    throw new DecodeError("integer exceeds the safe range");
  }
  return n;
}

function assertSafeCount(value: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("expected a non-negative safe integer");
  }
}

/** A `Timestamp` (milliseconds since the Unix epoch) as `u64` (plan §5.4). */
export const timestamp: Codec<number> = enhanceCodec<bigint, number>(
  u64,
  (value) => {
    assertSafeCount(value);
    return BigInt(value);
  },
  toSafeInteger,
);

/** A `Count` as a SCALE compact integer: the spec implies no width (SPEC.md §5 preamble). */
export const count: Codec<number> = enhanceCodec<number | bigint, number>(
  compact,
  (value) => {
    assertSafeCount(value);
    return value;
  },
  toSafeInteger,
);
