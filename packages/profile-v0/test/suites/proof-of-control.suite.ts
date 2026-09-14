// T-003-11 — proof of control (features/003-profile-v0/plan.md §5.4a;
// REQ-SP-4, REQ-CP-6). Done when: a valid proof verifies; one for another
// account, another credential, another audience, or past its expiry fails.

import type { AccountId, Authorisation, PassId } from "@ticketto/sdk";
import { ascii, concatBytes, fromHex } from "../../src/bytes.js";
import { encodeCommand } from "../../src/codec/command.js";
import { encodeAuthorisation } from "../../src/credential/credential.js";
import { webAuthnChallenge } from "../../src/credential/webauthn.js";
import { hashedUserId } from "../../src/derive.js";
import { encodePass } from "../../src/pass.js";
import { createProfileV0 } from "../../src/profile.js";
import {
  PROOF_OF_CONTROL_TAG,
  type ProofOfControlChallenge,
  proofOfControlSigningPayload,
  signProofOfControl,
  verifyProofOfControl,
} from "../../src/proof-of-control.js";
import { COMMAND_SIGNING_TAG, PASS_SIGNING_TAG } from "../../src/signing.js";
import { simulatedWebAuthnSigner } from "../../src/testing/signers.js";
import { assert, assertEqual, assertThrows, type Suite } from "../harness.js";
import { p256Key } from "../keys.js";
import { Random } from "../random.js";
import { p256Credential, type TestCredential, webAuthnCredential } from "../signers.js";

const RP_ID = "kippu.example";
const CONFIG = { rpId: RP_ID };
const T0 = 1_760_000_000_000;

function challengeFor(random: Random, account: AccountId): ProofOfControlChallenge {
  return {
    audience: ascii("kippu-api/holder-linking"),
    nonce: random.bytes(32),
    expiresAt: T0 + 120_000,
    account,
  };
}

export const proofOfControlSuite: Suite = ({ describe, it }) => {
  describe("T-003-11 proof-of-control payload", () => {
    it("is the tag followed by SCALE(audience Vec<u8>, nonce [u8;32], expiresAt u64, account [u8;32])", () => {
      const random = new Random(0x9c01);
      const account = random.accountId();
      const challenge: ProofOfControlChallenge = {
        audience: Uint8Array.of(0xaa, 0xbb, 0xcc),
        nonce: random.bytes(32),
        expiresAt: 0x0102030405,
        account,
      };
      assertEqual(PROOF_OF_CONTROL_TAG, ascii("ticketto/v0/proof-of-control"));
      assertEqual(
        proofOfControlSigningPayload(challenge),
        concatBytes(
          ascii("ticketto/v0/proof-of-control"),
          Uint8Array.of(3 << 2, 0xaa, 0xbb, 0xcc),
          challenge.nonce,
          Uint8Array.of(0x05, 0x04, 0x03, 0x02, 0x01, 0, 0, 0),
          fromHex(account, 32),
        ),
      );
    });

    it("refuses a challenge it cannot encode", () => {
      const random = new Random(0x9c02);
      const challenge = challengeFor(random, random.accountId());
      assertThrows(() => proofOfControlSigningPayload({ ...challenge, nonce: random.bytes(31) }));
      assertThrows(() => proofOfControlSigningPayload({ ...challenge, expiresAt: -1 }));
      assertThrows(() =>
        proofOfControlSigningPayload({ ...challenge, account: "00" as AccountId }),
      );
    });

    it("no signing tag is a prefix of another", () => {
      const tags = [PROOF_OF_CONTROL_TAG, COMMAND_SIGNING_TAG, PASS_SIGNING_TAG];
      for (const a of tags) {
        for (const b of tags) {
          if (a === b) continue;
          const prefix = b.length >= a.length && a.every((byte, i) => b[i] === byte);
          assert(!prefix, "a signing tag is a prefix of another");
        }
      }
    });
  });

  const kinds: [string, (random: Random) => TestCredential][] = [
    ["pass-webauthn", (random) => webAuthnCredential(random, RP_ID)],
    ["p256", p256Credential],
  ];

  for (const [kind, credential] of kinds) {
    describe(`T-003-11 proofs of control signed by ${kind}`, () => {
      const random = new Random(kind.length * 0x9c1);
      const holder = credential(random);
      const stranger = credential(random);
      const account = holder.signer.account;
      const challenge = challengeFor(random, account);

      it("a valid proof verifies, strictly before its expiry", async () => {
        const authorisation = await signProofOfControl(challenge, holder.signer);
        assertEqual(
          verifyProofOfControl(challenge, authorisation, holder.registration, T0, CONFIG),
          { ok: true, account },
        );
        assertEqual(
          verifyProofOfControl(
            challenge,
            authorisation,
            holder.registration,
            challenge.expiresAt - 1,
            CONFIG,
          ),
          { ok: true, account },
        );
      });

      it("a proof past its expiry fails", async () => {
        const authorisation = await signProofOfControl(challenge, holder.signer);
        for (const now of [challenge.expiresAt, challenge.expiresAt + 1]) {
          assertEqual(
            verifyProofOfControl(challenge, authorisation, holder.registration, now, CONFIG),
            { ok: false, failure: "expired" },
          );
        }
      });

      it("a proof for another account fails", async () => {
        const forStranger = { ...challenge, account: stranger.signer.account };
        // Signed by the holder over a challenge naming someone else's account.
        const authorisation = await holder.signer.sign(proofOfControlSigningPayload(forStranger));
        assertEqual(
          verifyProofOfControl(forStranger, authorisation, holder.registration, T0, CONFIG),
          { ok: false, failure: "account" },
        );
        // The same, checked against the other account's own registration.
        assertEqual(
          verifyProofOfControl(forStranger, authorisation, stranger.registration, T0, CONFIG),
          { ok: false, failure: "credential" },
        );
        // A proof the holder really gave, presented for another account.
        const own = await signProofOfControl(challenge, holder.signer);
        assertEqual(verifyProofOfControl(forStranger, own, stranger.registration, T0, CONFIG), {
          ok: false,
          failure: "credential",
        });
      });

      it("a proof for another audience, nonce or expiry fails", async () => {
        const authorisation = await signProofOfControl(challenge, holder.signer);
        const altered: ProofOfControlChallenge[] = [
          { ...challenge, audience: ascii("another-verifier") },
          { ...challenge, nonce: random.bytes(32) },
          { ...challenge, expiresAt: challenge.expiresAt + 60_000 },
        ];
        for (const other of altered) {
          assertEqual(verifyProofOfControl(other, authorisation, holder.registration, T0, CONFIG), {
            ok: false,
            failure: "signature",
          });
        }
      });

      it("a signature over a command, a pass, or the untagged challenge is no proof", async () => {
        const body = proofOfControlSigningPayload(challenge).subarray(PROOF_OF_CONTROL_TAG.length);
        const pass = {
          ticket: random.ticketId(),
          holder: account,
          id: random.hex<PassId>(16),
          notBefore: T0,
          notAfter: T0 + 60_000,
        };
        const signatures = [
          await holder.signer.sign(body),
          await holder.signer.sign(concatBytes(COMMAND_SIGNING_TAG, body)),
          await holder.signer.sign(concatBytes(PASS_SIGNING_TAG, encodePass(pass))),
          await holder.signer.sign(
            concatBytes(COMMAND_SIGNING_TAG, encodeCommand(random.command())),
          ),
        ];
        for (const authorisation of signatures) {
          assertEqual(
            verifyProofOfControl(challenge, authorisation, holder.registration, T0, CONFIG),
            { ok: false, failure: "signature" },
          );
        }
        // Nor does a proof verify as a command or pass signature.
        const proof = await signProofOfControl(challenge, holder.signer);
        const profile = createProfileV0(CONFIG);
        assert(!profile.verify(holder.registration, concatBytes(COMMAND_SIGNING_TAG, body), proof));
        assert(!profile.verify(holder.registration, concatBytes(PASS_SIGNING_TAG, body), proof));
      });

      it("a malformed registration or authorisation fails", async () => {
        const authorisation = await signProofOfControl(challenge, holder.signer);
        assertEqual(
          verifyProofOfControl(
            challenge,
            authorisation,
            random.bytes(40) as typeof holder.registration,
            T0,
            CONFIG,
          ),
          { ok: false, failure: "account" },
        );
        assertEqual(
          verifyProofOfControl(
            challenge,
            random.bytes(40) as Authorisation,
            holder.registration,
            T0,
            CONFIG,
          ),
          { ok: false, failure: "credential" },
        );
      });

      it("signing refuses a signer of another account", async () => {
        let refused = false;
        try {
          await signProofOfControl(
            { ...challenge, account: stranger.signer.account },
            holder.signer,
          );
        } catch (error) {
          refused = error instanceof TypeError;
        }
        assert(refused, "signProofOfControl signed for another account");
      });
    });
  }

  describe("T-003-11 proofs of control from a holder's passkeys", () => {
    const random = new Random(0x9c0d);
    const userId = random.hex<string>(32);
    const device = (rpId = RP_ID) =>
      simulatedWebAuthnSigner({
        rpId,
        userId,
        secretKey: p256Key(random).secretKey,
        credentialId: random.bytes(32),
      });
    const first = device();
    const second = device();
    const account = first.signer.account;
    const challenge = challengeFor(random, account);

    it("each of an account's credentials proves control against its own registration (REQ-CP-6)", async () => {
      assertEqual(second.signer.account, account);
      for (const { signer, registration } of [first, second]) {
        const authorisation = await signProofOfControl(challenge, signer);
        assertEqual(verifyProofOfControl(challenge, authorisation, registration, T0, CONFIG), {
          ok: true,
          account,
        });
      }
    });

    it("a proof from another credential of the same account fails", async () => {
      const bySecond = await signProofOfControl(challenge, second.signer);
      assertEqual(verifyProofOfControl(challenge, bySecond, first.registration, T0, CONFIG), {
        ok: false,
        failure: "credential",
      });
    });

    it("a passkey assertion for another RP id, or without user verification, fails", async () => {
      const payload = proofOfControlSigningPayload(challenge);
      for (const overrides of [{ rpId: "evil.example" }, { userVerified: false }]) {
        const authorisation = encodeAuthorisation({
          kind: "passWebAuthn",
          deviceId: first.authenticator.deviceId,
          assertion: first.authenticator.assert(
            hashedUserId(first.userId),
            webAuthnChallenge(payload),
            overrides,
          ),
        });
        assertEqual(
          verifyProofOfControl(challenge, authorisation, first.registration, T0, CONFIG),
          { ok: false, failure: "signature" },
        );
      }
      // And the configured RP id is the verifier's, not the proof's.
      const valid = await signProofOfControl(challenge, first.signer);
      assertEqual(
        verifyProofOfControl(challenge, valid, first.registration, T0, { rpId: "evil.example" }),
        { ok: false, failure: "signature" },
      );
    });
  });
};
