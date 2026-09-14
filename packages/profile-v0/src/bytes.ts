// Byte helpers shared by the codecs and derivations.
//
// Identifiers cross the SDK surface as lower-case hex of their canonical bytes
// (features/002-sdk/plan.md §5.1). Parsing is strict: upper-case digits, a
// `0x` prefix or an odd length are refused, so that one identifier has exactly
// one string form.

const HEX_DIGITS = "0123456789abcdef";

/** Lower-case hex of `bytes`, with no prefix. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 15);
  }
  return out;
}

function nibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 102) return code - 87; // a-f
  return -1;
}

/**
 * The bytes of a lower-case hex string. Throws a `TypeError` for anything else,
 * or when `length` is given and the string does not hold exactly that many bytes.
 */
export function fromHex(hex: string, length?: number): Uint8Array {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    throw new TypeError("expected lower-case hex of an even length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const hi = nibble(hex.charCodeAt(2 * i));
    const lo = nibble(hex.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) throw new TypeError("expected lower-case hex");
    bytes[i] = (hi << 4) | lo;
  }
  if (length !== undefined && bytes.length !== length) {
    throw new TypeError(`expected ${length} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** `parts` concatenated. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Whether `a` and `b` hold the same bytes. Not constant-time: use only on public values. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The ASCII bytes of a domain-separation tag. */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) throw new TypeError("expected ASCII");
    out[i] = code;
  }
  return out;
}
