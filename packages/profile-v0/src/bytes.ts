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

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url of `bytes` (RFC 4648 §5), as WebAuthn client data carries a challenge. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      BASE64URL.charAt(n >> 18) +
      BASE64URL.charAt((n >> 12) & 63) +
      BASE64URL.charAt((n >> 6) & 63) +
      BASE64URL.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += BASE64URL.charAt(n >> 18) + BASE64URL.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out +=
      BASE64URL.charAt(n >> 18) +
      BASE64URL.charAt((n >> 12) & 63) +
      BASE64URL.charAt((n >> 6) & 63);
  }
  return out;
}

/** The text of strict UTF-8 `bytes`; throws a `TypeError` for invalid UTF-8. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] ?? 0;
    let code: number;
    let size: number;
    if (b0 < 0x80) {
      code = b0;
      size = 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      code = b0 & 0x1f;
      size = 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      code = b0 & 0x0f;
      size = 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      code = b0 & 0x07;
      size = 4;
    } else {
      throw new TypeError("invalid UTF-8");
    }
    if (i + size > bytes.length) throw new TypeError("invalid UTF-8");
    for (let k = 1; k < size; k++) {
      const b = bytes[i + k] ?? 0;
      if ((b & 0xc0) !== 0x80) throw new TypeError("invalid UTF-8");
      code = (code << 6) | (b & 0x3f);
    }
    const min = [0, 0, 0x80, 0x800, 0x10000][size] ?? 0;
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new TypeError("invalid UTF-8");
    }
    out += String.fromCodePoint(code);
    i += size;
  }
  return out;
}
