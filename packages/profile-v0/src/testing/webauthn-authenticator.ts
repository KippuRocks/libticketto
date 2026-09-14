// A simulated WebAuthn platform authenticator, for tests and the conformance
// suite only (features/003-profile-v0/plan.md §5.6). It emits what a real
// authenticator does — authenticator data, client data JSON, a SubjectPublicKeyInfo
// public key and DER ECDSA P-256 signatures — with no hardware.
//
// Never use it to hold a real holder's key: the secret key is a plain byte array.

import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ascii, concatBytes, toBase64Url } from "../bytes.js";
import {
  type Assertion,
  type Attestation,
  KREIVO_AUTHORITY_ID,
  P256_SPKI_PREFIX,
  V0_CONTEXT,
} from "../credential/webauthn.js";
import { deviceId } from "../derive.js";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

export interface SimulatedAuthenticatorOptions {
  readonly rpId: string;
  /** A 32-byte P-256 secret key. */
  readonly secretKey: Uint8Array;
  /** The credential's raw id; its BLAKE2b-256 is the device id. */
  readonly credentialId: Uint8Array;
}

/** Deviations from a well-formed ceremony, so that tests can build invalid assertions. */
export interface CeremonyOverrides {
  readonly type?: string;
  /** Replaces the challenge the client data carries. */
  readonly challenge?: Uint8Array;
  /** Signs for this RP id instead of the authenticator's own. */
  readonly rpId?: string;
  readonly userVerified?: boolean;
  readonly context?: number;
  readonly authorityId?: Uint8Array;
  /** Emits the high-S form of the signature, which authenticators are free to do. */
  readonly highS?: boolean;
}

function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >> 8) & 255, n & 255);
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

export class SimulatedWebAuthnAuthenticator {
  readonly rpId: string;
  readonly credentialId: Uint8Array;
  private readonly secretKey: Uint8Array;
  private signCount = 0;

  constructor(options: SimulatedAuthenticatorOptions) {
    if (!p256.utils.isValidSecretKey(options.secretKey)) {
      throw new TypeError("expected a valid P-256 secret key");
    }
    this.rpId = options.rpId;
    this.secretKey = options.secretKey.slice();
    this.credentialId = options.credentialId.slice();
  }

  /** `BLAKE2b-256(credentialId)`. */
  get deviceId(): Uint8Array {
    return deviceId(this.credentialId);
  }

  /** The uncompressed public key point. */
  get publicKeyPoint(): Uint8Array {
    return p256.getPublicKey(this.secretKey, false);
  }

  /** The public key as DER SubjectPublicKeyInfo, as `getPublicKey()` returns it. */
  get publicKeySpki(): Uint8Array {
    return concatBytes(P256_SPKI_PREFIX, this.publicKeyPoint);
  }

  private clientData(type: string, challenge: Uint8Array): Uint8Array {
    const json = JSON.stringify({
      type,
      challenge: toBase64Url(challenge),
      origin: `https://${this.rpId}`,
      crossOrigin: false,
    });
    return ascii(json);
  }

  private authenticatorData(rpId: string, flags: number, attested?: Uint8Array): Uint8Array {
    this.signCount++;
    return concatBytes(
      sha256(ascii(rpId)),
      Uint8Array.of(flags),
      u32be(this.signCount),
      attested ?? new Uint8Array(0),
    );
  }

  private coseKey(): Uint8Array {
    const point = this.publicKeyPoint;
    // {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    return concatBytes(
      Uint8Array.of(0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20),
      point.subarray(1, 33),
      Uint8Array.of(0x22, 0x58, 0x20),
      point.subarray(33, 65),
    );
  }

  private sign(message: Uint8Array, highS: boolean): Uint8Array {
    const compact = p256.sign(message, this.secretKey, { prehash: true, lowS: true });
    let signature = p256.Signature.fromBytes(compact, "compact");
    if (highS) signature = new p256.Signature(signature.r, p256.Point.Fn.ORDER - signature.s);
    return signature.toBytes("der");
  }

  private flags(overrides: CeremonyOverrides): number {
    return FLAG_USER_PRESENT | (overrides.userVerified === false ? 0 : FLAG_USER_VERIFIED);
  }

  /** A registration ceremony (`navigator.credentials.create`) over `challenge`. */
  attest(challenge: Uint8Array, overrides: CeremonyOverrides = {}): Attestation {
    const attested = concatBytes(
      new Uint8Array(16), // AAGUID
      u16be(this.credentialId.length),
      this.credentialId,
      this.coseKey(),
    );
    return {
      meta: {
        authority_id: overrides.authorityId ?? KREIVO_AUTHORITY_ID,
        device_id: this.deviceId,
        context: overrides.context ?? V0_CONTEXT,
      },
      authenticator_data: this.authenticatorData(
        overrides.rpId ?? this.rpId,
        this.flags(overrides) | FLAG_ATTESTED_CREDENTIAL_DATA,
        attested,
      ),
      client_data: this.clientData(overrides.type ?? "webauthn.create", challenge),
      public_key: this.publicKeySpki,
    };
  }

  /**
   * An authentication ceremony (`navigator.credentials.get`) over `challenge`,
   * for the holder whose hashed user id is `hashedUserId`.
   */
  assert(
    hashedUserId: Uint8Array,
    challenge: Uint8Array,
    overrides: CeremonyOverrides = {},
  ): Assertion {
    const authenticatorData = this.authenticatorData(
      overrides.rpId ?? this.rpId,
      this.flags(overrides),
    );
    const clientData = this.clientData(
      overrides.type ?? "webauthn.get",
      overrides.challenge ?? challenge,
    );
    return {
      meta: {
        authority_id: overrides.authorityId ?? KREIVO_AUTHORITY_ID,
        user_id: hashedUserId,
        context: overrides.context ?? V0_CONTEXT,
      },
      authenticator_data: authenticatorData,
      client_data: clientData,
      signature: this.sign(
        concatBytes(authenticatorData, sha256(clientData)),
        overrides.highS ?? false,
      ),
    };
  }
}
