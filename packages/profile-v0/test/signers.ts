// Suite-local signers over test keys. T-003-07 ships the real software signers
// under `@ticketto/profile-v0/testing`.

import type { AccountId, Authorisation, Registration, Signer } from "@ticketto/sdk";
import { fromHex } from "../src/bytes.js";
import { encodeAuthorisation, encodeRegistration } from "../src/credential/credential.js";
import { p256AuthorisationDigest, p256RegistrationDigest } from "../src/credential/p256.js";
import { webAuthnChallenge } from "../src/credential/webauthn.js";
import { hashedUserId, holderAccountId, p256AccountId } from "../src/derive.js";
import { SimulatedWebAuthnAuthenticator } from "../src/testing/webauthn-authenticator.js";
import { p256Key, signDigest } from "./keys.js";
import type { Random } from "./random.js";

export interface TestCredential {
  readonly signer: Signer;
  readonly registration: Registration;
}

export function p256Credential(random: Random): TestCredential {
  const key = p256Key(random);
  return {
    signer: {
      account: p256AccountId(key.publicKey),
      sign: async (payload) =>
        encodeAuthorisation({
          kind: "p256",
          publicKey: key.publicKey,
          signature: signDigest(key, p256AuthorisationDigest(payload)),
        }),
    },
    registration: encodeRegistration({
      kind: "p256",
      publicKey: key.publicKey,
      signature: signDigest(key, p256RegistrationDigest(key.publicKey)),
    }),
  };
}

export function webAuthnCredential(random: Random, rpId: string): TestCredential {
  const userId = random.hex<string>(32);
  const authenticator = new SimulatedWebAuthnAuthenticator({
    rpId,
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(32),
  });
  const hashed = hashedUserId(userId);
  const account: AccountId = holderAccountId(userId);
  return {
    signer: {
      account,
      sign: async (payload): Promise<Authorisation> =>
        encodeAuthorisation({
          kind: "passWebAuthn",
          deviceId: authenticator.deviceId,
          assertion: authenticator.assert(hashed, webAuthnChallenge(payload)),
        }),
    },
    registration: encodeRegistration({
      kind: "passWebAuthn",
      hashedUserId: hashed,
      attestation: authenticator.attest(fromHex(account)),
    }),
  };
}
