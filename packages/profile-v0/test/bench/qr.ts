// QR code capacity in byte mode at error correction level M (ISO/IEC 18004),
// versions 1–40. Cross-checked against the `qrcode` package in
// src/pass.bench.test.ts.

export const BYTE_CAPACITY_M: readonly number[] = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989,
  2099, 2213, 2331,
];

/** The smallest QR version holding `bytes` in byte mode at level M, or `null` beyond version 40. */
export function qrVersionM(bytes: number): number | null {
  const index = BYTE_CAPACITY_M.findIndex((capacity) => capacity >= bytes);
  return index < 0 ? null : index + 1;
}
