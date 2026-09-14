// T-003-06 — the V0 profile wired to F-002's `Profile` interface (REQ-CP-2).

import type { PassId, Profile } from "@ticketto/sdk";
import { decodeCommand } from "../../src/codec/command.js";
import { eventId, ticketId } from "../../src/derive.js";
import { encodeSignedPass, producePass } from "../../src/pass.js";
import { createProfileV0 } from "../../src/profile.js";
import { assert, assertEqual, assertThrows, type Suite } from "../harness.js";
import { Random } from "../random.js";
import { p256Credential, webAuthnCredential } from "../signers.js";

const RP_ID = "kippu.example";

export const profileSuite: Suite = ({ describe, it }) => {
  describe("T-003-06 createProfileV0", () => {
    const profile: Profile = createProfileV0({ rpId: RP_ID });
    const random = new Random(0x960f);

    it("derives identifiers as the profile defines them", () => {
      const creator = random.accountId();
      const salt = random.bytes(16);
      assertEqual(profile.eventId(creator, salt), eventId(creator, salt));
      const placement = random.placement();
      const event = random.eventId();
      const zone = random.zoneId();
      assertEqual(profile.ticketId(event, zone, placement), ticketId(event, zone, placement));
    });

    it("encodes commands canonically", () => {
      for (let run = 0; run < 20; run++) {
        const command = random.command();
        assertEqual(decodeCommand(profile.encodeCommand(command)), command);
      }
    });

    for (const [kind, make] of [
      ["pass-webauthn", (r: Random) => webAuthnCredential(r, RP_ID)],
      ["p256", p256Credential],
    ] as const) {
      it(`verifies ${kind} authorisations through the interface`, async () => {
        const { signer, registration } = make(random);
        const other = make(random);
        const payload = profile.encodeCommand(random.command());
        const authorisation = await signer.sign(payload);

        const claimed = profile.accountOf(authorisation);
        const registered = profile.registrationAccount(registration);
        assert(claimed.ok && registered.ok, "both name an account");
        assertEqual(claimed.value, registered.value);
        assertEqual(claimed.value.account, signer.account);
        assert(profile.verify(registration, payload, authorisation), "verifies");
        assert(!profile.verify(other.registration, payload, authorisation), "not another's");
        assert(!profile.verify(registration, payload.subarray(1), authorisation), "not tampered");
      });

      it(`round-trips ${kind} signed passes through the interface`, async () => {
        const { signer } = make(random);
        const signed = await producePass(
          {
            ticket: random.ticketId(),
            holder: signer.account,
            notBefore: 1,
            id: random.hex<PassId>(16),
          },
          signer,
        );
        assertEqual(profile.encodePass(signed.pass).length, 97);
        assertEqual(profile.decodePass(encodeSignedPass(signed)), { ok: true, value: signed });
        const bad = profile.decodePass(Uint8Array.of(1, 2, 3));
        assert(!bad.ok && bad.error.code === "ERR-InvalidPass");
      });
    }

    it("binds the RP id: a passkey for another RP id does not verify", async () => {
      const { signer, registration } = webAuthnCredential(random, "other.example");
      const payload = random.bytes(40);
      const authorisation = await signer.sign(payload);
      assert(!profile.verify(registration, payload, authorisation));
      assert(
        createProfileV0({ rpId: "other.example" }).verify(registration, payload, authorisation),
      );
    });

    it("refuses an empty or non-ASCII RP id", () => {
      assertThrows(() => createProfileV0({ rpId: "" }), "TypeError");
      assertThrows(() => createProfileV0({ rpId: "kippu.rocksé" }), "TypeError");
    });
  });
};
