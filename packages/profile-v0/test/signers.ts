// Suite credentials with seeded keys, through the software signers of
// `@ticketto/profile-v0/testing`.

import {
  type SoftwareCredential,
  simulatedWebAuthnSigner,
  softwareP256Signer,
} from "../src/testing/signers.js";
import { p256Key } from "./keys.js";
import type { Random } from "./random.js";

export type TestCredential = SoftwareCredential;

export function p256Credential(random: Random): TestCredential {
  return softwareP256Signer({ secretKey: p256Key(random).secretKey });
}

export function webAuthnCredential(random: Random, rpId: string): TestCredential {
  return simulatedWebAuthnSigner({
    rpId,
    userId: random.hex<string>(32),
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(32),
  });
}
