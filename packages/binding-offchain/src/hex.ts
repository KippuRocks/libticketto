// C4.md §1.2: canonical bytes travel as lower-case hexadecimal, even length, no
// prefix. Written here rather than borrowed from a Node API, because this
// package runs on React Native (Hermes) as well as Node.

const HEX = /^(?:[0-9a-f]{2})*$/;

/** Lower-case hex of an even length, possibly empty — what C4 accepts as bytes. */
export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The bytes a C4 hex string carries. Throws on anything C4 calls malformed. */
export function fromHex(hex: string): Uint8Array {
  if (!isHex(hex)) throw new TypeError("expected lower-case hex of an even length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}
