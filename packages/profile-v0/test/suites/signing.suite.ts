// Domain separation of what is signed (features/003-profile-v0/plan.md §5.7,
// ruling 3; REQ-CP-6, REQ-AP-1): a command signature never verifies as a pass
// signature, nor a pass signature as a command signature, for either credential kind.

import type { Command, PassId, Profile, ProofId } from "@ticketto/sdk";
import { ascii, concatBytes, toHex } from "../../src/bytes.js";
import { decodeCommand, encodeCommand } from "../../src/codec/command.js";
import {
  decodePassBytes,
  encodePass,
  PASS_LENGTH,
  passSigningPayload,
  verifyPass,
} from "../../src/pass.js";
import { createProfileV0 } from "../../src/profile.js";
import { COMMAND_SIGNING_TAG, commandSigningPayload, PASS_SIGNING_TAG } from "../../src/signing.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { Random } from "../random.js";
import { p256Credential, type TestCredential, webAuthnCredential } from "../signers.js";

const RP_ID = "kippu.example";
const T0 = 1_760_000_000_000;

export const signingSuite: Suite = ({ describe, it }) => {
  describe("plan §5.7 signing payloads", () => {
    const profile: Profile = createProfileV0({ rpId: RP_ID });
    const random = new Random(0x5167);

    it("the profile signs commands and passes behind their domain tags", () => {
      assertEqual(COMMAND_SIGNING_TAG, ascii("ticketto/v0/command"));
      assertEqual(PASS_SIGNING_TAG, ascii("ticketto/v0/pass"));
      const command = random.command();
      assertEqual(
        profile.encodeCommand(command),
        concatBytes(COMMAND_SIGNING_TAG, encodeCommand(command)),
      );
      assertEqual(profile.encodeCommand(command), commandSigningPayload(command));
      const pass = {
        ticket: random.ticketId(),
        holder: random.accountId(),
        id: random.hex<PassId>(16),
        notBefore: T0,
        notAfter: T0 + 60_000,
      };
      assertEqual(profile.encodePass(pass), concatBytes(PASS_SIGNING_TAG, encodePass(pass)));
      assertEqual(profile.encodePass(pass), passSigningPayload(pass));
    });
  });

  const kinds: [string, (random: Random) => TestCredential][] = [
    ["pass-webauthn", (random) => webAuthnCredential(random, RP_ID)],
    ["p256", p256Credential],
  ];

  for (const [kind, credential] of kinds) {
    describe(`plan §5.7 domain separation, ${kind}`, () => {
      const profile: Profile = createProfileV0({ rpId: RP_ID });
      const random = new Random(kind.length * 0x51);
      const { signer, registration } = credential(random);

      it("a valid command signature does not verify as a pass signature", async () => {
        const bytes = encodeCommand(random.command());
        const authorisation = await signer.sign(concatBytes(COMMAND_SIGNING_TAG, bytes));
        assert(
          profile.verify(registration, concatBytes(COMMAND_SIGNING_TAG, bytes), authorisation),
        );
        assert(!profile.verify(registration, concatBytes(PASS_SIGNING_TAG, bytes), authorisation));
        assert(!profile.verify(registration, bytes, authorisation), "nor untagged");
      });

      it("a valid pass signature does not verify as a command signature", async () => {
        const pass = {
          ticket: random.ticketId(),
          holder: signer.account,
          id: random.hex<PassId>(16),
          notBefore: T0,
          notAfter: T0 + 60_000,
        };
        const bytes = encodePass(pass);
        const authorisation = await signer.sign(profile.encodePass(pass));
        assert(
          verifyPass({ pass, authorisation }, registration, { now: () => T0 }, { rpId: RP_ID }).ok,
        );
        assert(
          !profile.verify(registration, concatBytes(COMMAND_SIGNING_TAG, bytes), authorisation),
        );
        assert(!profile.verify(registration, bytes, authorisation), "nor untagged");

        const asCommand = await signer.sign(concatBytes(COMMAND_SIGNING_TAG, bytes));
        const result = verifyPass(
          { pass, authorisation: asCommand },
          registration,
          { now: () => T0 },
          { rpId: RP_ID },
        );
        assert(
          !result.ok && result.error.code === "ERR-InvalidPass",
          "a command signature is no pass",
        );
      });

      it("bytes that are both a command and a pass verify only in the domain they were signed in", async () => {
        // setEventCapacity with capacity 1 and a 35-byte proof is 97 bytes, and
        // with zero timestamps at its tail it also decodes as an access pass.
        const proof = concatBytes(random.bytes(19), new Uint8Array(16));
        const command: Command = {
          kind: "setEventCapacity",
          operationId: random.operationId(),
          expiresAt: T0,
          event: random.eventId(),
          capacity: 1,
          proof: toHex(proof) as ProofId,
        };
        const bytes = encodeCommand(command);
        assertEqual(bytes.length, PASS_LENGTH);
        assertEqual(decodeCommand(bytes), command);
        const pass = decodePassBytes(bytes);

        const signedCommand = await signer.sign(profile.encodeCommand(command));
        assert(profile.verify(registration, profile.encodeCommand(command), signedCommand));
        assert(
          !profile.verify(registration, profile.encodePass(pass), signedCommand),
          "not as a pass",
        );

        const signedPass = await signer.sign(profile.encodePass(pass));
        assert(profile.verify(registration, profile.encodePass(pass), signedPass));
        assert(
          !profile.verify(registration, profile.encodeCommand(command), signedPass),
          "not as a command",
        );
      });
    });
  }
};
