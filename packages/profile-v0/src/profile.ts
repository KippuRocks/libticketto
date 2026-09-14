// The V0 profile as the SDK consumes it (`Profile`, C2; REQ-CP-2;
// features/003-profile-v0/plan.md §5). Nothing profile-specific escapes it: the
// SDK sees identifiers, opaque bytes and results.

import type { Profile } from "@ticketto/sdk";
import { accountOf, registrationAccount, verify } from "./credential/credential.js";
import type { WebAuthnConfig } from "./credential/webauthn.js";
import { eventId, ticketId } from "./derive.js";
import { decodePass, passSigningPayload } from "./pass.js";
import { commandSigningPayload } from "./signing.js";

/** Deployment configuration of the V0 profile. */
export interface ProfileV0Config {
  /**
   * The WebAuthn relying party id holder passkeys are bound to. Changing it
   * invalidates every holder passkey: a profile change, and therefore a
   * migration (plan §5.3, `REQ-MG-6`).
   */
  readonly rpId: WebAuthnConfig["rpId"];
}

const RP_ID = /^[\x21-\x7e]+$/;

/** The V0 cryptographic profile, for one deployment's configuration. */
export function createProfileV0(config: ProfileV0Config): Profile {
  if (typeof config.rpId !== "string" || !RP_ID.test(config.rpId)) {
    throw new TypeError("the WebAuthn RP id is a non-empty ASCII domain");
  }
  const credentialConfig: WebAuthnConfig = { rpId: config.rpId };
  return {
    eventId,
    ticketId,
    // What a signer authorises: the command and pass bytes behind their domain
    // tags (plan §5.7). Sign and verify these, never the untagged bytes.
    encodeCommand: commandSigningPayload,
    accountOf,
    registrationAccount,
    verify: (registration, payload, authorisation) =>
      verify(registration, payload, authorisation, credentialConfig),
    encodePass: passSigningPayload,
    decodePass,
  };
}
