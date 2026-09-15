// The SCALE subset the log's formats use (AD-11): `u8`, little-endian `u64`,
// compact integers for lengths, `Option`, fixed and length-prefixed bytes.
//
// Encoding validates values before writing them. Decoding is strict: it
// accepts only the canonical encoding — minimal compact integers, option tags
// 0 and 1, no trailing bytes, no length that runs past the input — so no two
// byte strings stand for one record or checkpoint.

import { concatBytes, equalBytes } from "./bytes.js";

/**
 * A self-delimiting codec of another format — the profile's (`C2`) encodings of
 * zones, placements, policies and the like — read and written in place.
 */
export interface ForeignCodec<T> {
  readonly enc: (value: T) => Uint8Array;
  readonly dec: (bytes: Uint8Array) => T;
}

/** Raised when bytes are not the canonical encoding of a log value. */
export class LogDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogDecodeError";
  }
}

function assertU64Number(value: number, what: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${what}: expected a non-negative safe integer`);
  }
}

/** Accumulates an encoding. */
export class Writer {
  readonly #parts: Uint8Array[] = [];

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new TypeError("expected a byte");
    }
    this.#parts.push(Uint8Array.of(value));
    return this;
  }

  /** A `u64`, little-endian, from a non-negative safe integer. */
  u64(value: number, what = "u64"): this {
    assertU64Number(value, what);
    const out = new Uint8Array(8);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setBigUint64(0, BigInt(value), true);
    this.#parts.push(out);
    return this;
  }

  /** A SCALE compact integer. */
  compact(value: number): this {
    assertU64Number(value, "compact");
    this.#parts.push(encodeCompact(value));
    return this;
  }

  /** Exactly `length` bytes, unprefixed. */
  fixed(bytes: Uint8Array, length: number, what = "bytes"): this {
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
      throw new TypeError(`${what}: expected ${length} bytes`);
    }
    this.#parts.push(bytes.slice());
    return this;
  }

  /** Bytes that are already an encoding, appended as they are. */
  raw(bytes: Uint8Array): this {
    this.#parts.push(bytes.slice());
    return this;
  }

  /** `Vec<u8>`: a compact length, then the bytes. */
  bytes(bytes: Uint8Array, what = "bytes"): this {
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`${what}: expected bytes`);
    this.compact(bytes.length);
    this.#parts.push(bytes.slice());
    return this;
  }

  /** `Option<T>`: `0`, or `1` followed by `T`. */
  option<T>(value: T | null, write: (writer: this, value: T) => void): this {
    if (value === null) return this.u8(0);
    this.u8(1);
    write(this, value);
    return this;
  }

  /** `value` in another format's encoding, appended as it is. */
  codec<T>(codec: ForeignCodec<T>, value: T): this {
    this.#parts.push(codec.enc(value));
    return this;
  }

  finish(): Uint8Array {
    return concatBytes(...this.#parts);
  }
}

function encodeCompact(value: number): Uint8Array {
  if (value < 1 << 6) return Uint8Array.of(value << 2);
  if (value < 1 << 14) {
    const n = (value << 2) | 1;
    return Uint8Array.of(n & 0xff, n >> 8);
  }
  if (value < 2 ** 30) {
    const n = value * 4 + 2;
    return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  }
  const bytes: number[] = [];
  let rest = BigInt(value);
  while (rest > 0n) {
    bytes.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return Uint8Array.of(((bytes.length - 4) << 2) | 3, ...bytes);
}

/** Reads an encoding from the front. */
export class Reader {
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    // A plain `Uint8Array` over the same memory, whatever view it was given: a
    // Node `Buffer`'s `slice` returns another view into its pool instead of a
    // copy, so everything read below is taken from this view, never `bytes`.
    this.#bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  #take(length: number): Uint8Array {
    if (length > this.#bytes.length - this.#offset)
      throw new LogDecodeError("unexpected end of input");
    const out = this.#bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return out;
  }

  u8(): number {
    return this.#take(1)[0] as number;
  }

  u64(): number {
    const bytes = this.#take(8);
    const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
      0,
      true,
    );
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new LogDecodeError("integer exceeds the safe range");
    }
    return Number(value);
  }

  compact(): number {
    const first = this.u8();
    const mode = first & 3;
    let value: number;
    if (mode === 0) {
      value = first >> 2;
    } else if (mode === 1) {
      value = (first | (this.u8() << 8)) >> 2;
      if (value < 1 << 6) throw new LogDecodeError("non-canonical compact integer");
    } else if (mode === 2) {
      const rest = this.#take(3);
      const n =
        first +
        (rest[0] as number) * 2 ** 8 +
        (rest[1] as number) * 2 ** 16 +
        (rest[2] as number) * 2 ** 24;
      value = (n - 2) / 4;
      if (value < 1 << 14) throw new LogDecodeError("non-canonical compact integer");
    } else {
      const length = (first >> 2) + 4;
      const bytes = this.#take(length);
      if (bytes[length - 1] === 0) throw new LogDecodeError("non-canonical compact integer");
      let big = 0n;
      for (let i = length - 1; i >= 0; i--) big = (big << 8n) | BigInt(bytes[i] as number);
      if (big < 2n ** 30n) throw new LogDecodeError("non-canonical compact integer");
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new LogDecodeError("integer exceeds the safe range");
      }
      value = Number(big);
    }
    return value;
  }

  fixed(length: number): Uint8Array {
    return this.#take(length);
  }

  bytes(): Uint8Array {
    return this.#take(this.compact());
  }

  option<T>(read: (reader: this) => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag === 1) return read(this);
    throw new LogDecodeError(`invalid option tag ${tag}`);
  }

  /**
   * A value in another format's self-delimiting encoding. Only its canonical
   * encoding is accepted: the value must re-encode to exactly the bytes read.
   */
  codec<T>(codec: ForeignCodec<T>, what = "value"): T {
    const rest = this.#bytes.slice(this.#offset);
    let value: T;
    let encoded: Uint8Array;
    try {
      value = codec.dec(rest);
      encoded = codec.enc(value);
    } catch (error) {
      throw new LogDecodeError(
        `${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (encoded.length > rest.length || !equalBytes(encoded, rest.subarray(0, encoded.length))) {
      throw new LogDecodeError(`${what}: not the canonical encoding`);
    }
    this.#offset += encoded.length;
    return value;
  }

  /** How many bytes are left to read. */
  get remaining(): number {
    return this.#bytes.length - this.#offset;
  }

  /** Throws unless every byte has been read. */
  end(): void {
    if (this.#offset !== this.#bytes.length) throw new LogDecodeError("trailing bytes");
  }
}
