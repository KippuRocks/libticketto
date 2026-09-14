// Deterministic P-256 keys for suites. Not a signer: T-003-07 ships those.

import { p256 } from "@noble/curves/nist.js";
import type { Random } from "./random.js";

export interface TestKey {
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

export function p256Key(random: Random): TestKey {
  for (;;) {
    const secretKey = random.bytes(32);
    if (p256.utils.isValidSecretKey(secretKey)) {
      return { secretKey, publicKey: p256.getPublicKey(secretKey, true) };
    }
  }
}

/** ECDSA P-256 over a 32-byte digest, as 64-byte `r ‖ s` with low S. */
export function signDigest(key: TestKey, digest: Uint8Array): Uint8Array {
  return p256.sign(digest, key.secretKey, { prehash: false, lowS: true });
}
