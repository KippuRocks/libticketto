// Fixtures for the V0 profile — features/004-conformance/plan.md §5.1, REQ-CP-5.
//
// Software credentials from `@ticketto/profile-v0/testing`: the organiser holds
// a `p256` key, as Kippu's organiser authority does; holders hold simulated
// passkeys (`pass-webauthn`). Every key is derived from a fixed label, so a run
// is reproducible. These keys are public in this source file: never use them
// for anything but tests.

import { blake2b256, createProfileV0 } from "@ticketto/profile-v0";
import {
  type SoftwareCredential,
  simulatedWebAuthnSigner,
  softwareP256Signer,
} from "@ticketto/profile-v0/testing";
import type {
  ClassId,
  Discriminator,
  PassId,
  Position,
  ProofId,
  Sponsor,
  Sponsorship,
  ZoneId,
} from "@ticketto/sdk";
import type { ConformanceIdentifiers, ProfileFixtures } from "../harness.js";

/** The WebAuthn relying party id the V0 fixtures bind holder passkeys to. */
export const CONFORMANCE_RP_ID = "conformance.ticketto.test";

export interface ProfileV0FixtureOptions {
  /** Defaults to `CONFORMANCE_RP_ID`. */
  readonly rpId?: string;
  /**
   * The sponsor relaying every submission. Defaults to one issuing an empty
   * sponsorship, for backends that verify none (`F-005`); a backend that does
   * verify sponsorship supplies its own.
   */
  readonly sponsor?: Sponsor;
}

/** The bytes of an ASCII label. */
function ascii(label: string): Uint8Array {
  return Uint8Array.from(label, (char) => char.charCodeAt(0) & 0x7f);
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** 32 bytes derived from a label: distinct labels, distinct bytes. */
function derived(label: string): Uint8Array {
  return blake2b256(ascii(`ticketto/conformance/${label}`));
}

function holder(rpId: string, index: number, device = 0): SoftwareCredential {
  return simulatedWebAuthnSigner({
    rpId,
    userId: hex(derived(`holder/${index}/user`)),
    secretKey: derived(`holder/${index}/device/${device}/key`),
    credentialId: derived(`holder/${index}/device/${device}/credential`),
  });
}

/** A sponsor that relays everything with an empty sponsorship. */
export const emptySponsor: Sponsor = {
  sponsor: async () => ({ ok: true, value: new Uint8Array() as Sponsorship }),
};

/** Well-formed V0 identifier values: 32-byte zone ids, 128-bit discriminators. */
export const profileV0Identifiers: ConformanceIdentifiers = {
  zone: (index) => hex(derived(`zone/${index}`)) as ZoneId,
  class: (index) => hex(ascii(`class-${index}`)) as ClassId,
  position: (index) => hex(ascii(`seat-${index}`)) as Position,
  discriminator: (index) => hex(derived(`discriminator/${index}`).slice(0, 16)) as Discriminator,
  proof: (index) => hex(ascii(`proof-${index}`)) as ProofId,
  pass: (index) => hex(derived(`pass/${index}`).slice(0, 16)) as PassId,
  salt: (index) => derived(`salt/${index}`),
};

/** The profile, signers and identifiers for running the suite under the V0 profile. */
export function profileV0Fixtures(options: ProfileV0FixtureOptions = {}): ProfileFixtures {
  const rpId = options.rpId ?? CONFORMANCE_RP_ID;
  return {
    profile: createProfileV0({ rpId }),
    signers: {
      organiser: softwareP256Signer({ secretKey: derived("organiser/key") }),
      holders: [holder(rpId, 0), holder(rpId, 1), holder(rpId, 2)],
      secondDevice: holder(rpId, 0, 1),
      stranger: holder(rpId, 99),
      sponsor: options.sponsor ?? emptySponsor,
    },
    identifiers: profileV0Identifiers,
  };
}
