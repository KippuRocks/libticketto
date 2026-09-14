// What a React Native app provides and the bare Hermes VM does not.
//
// `scale-ts` constructs a `TextDecoder` when it is imported. Hermes ships
// `TextEncoder` but not `TextDecoder`, so a React Native app embedding this
// profile must install one before importing it — as apps using `polkadot-api`
// already do. This is a minimal UTF-8 decoder standing in for that polyfill.

class Utf8Decoder {
  readonly encoding = "utf-8";

  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (input === undefined) return "";
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let out = "";
    for (let i = 0; i < bytes.length; ) {
      const b0 = bytes[i++] ?? 0;
      let code = 0xfffd;
      if (b0 < 0x80) code = b0;
      else if (b0 >= 0xc2 && b0 < 0xe0 && i < bytes.length) {
        code = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
      } else if (b0 >= 0xe0 && b0 < 0xf0 && i + 1 < bytes.length) {
        code = ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
      } else if (b0 >= 0xf0 && b0 < 0xf5 && i + 2 < bytes.length) {
        code =
          ((b0 & 0x07) << 18) |
          (((bytes[i++] ?? 0) & 0x3f) << 12) |
          (((bytes[i++] ?? 0) & 0x3f) << 6) |
          ((bytes[i++] ?? 0) & 0x3f);
      }
      out += String.fromCodePoint(code);
    }
    return out;
  }
}

const scope = globalThis as { TextDecoder?: unknown };
if (scope.TextDecoder === undefined) scope.TextDecoder = Utf8Decoder;

export {};
