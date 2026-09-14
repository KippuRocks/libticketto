// T-003-07 — software signers under /testing sign every command kind without
// hardware (REQ-CP-5).

import type { CommandKind } from "@ticketto/sdk";
import { COMMAND_INDEX } from "../../src/codec/command.js";
import { createProfileV0 } from "../../src/profile.js";
import { simulatedWebAuthnSigner, softwareP256Signer } from "../../src/testing/signers.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { Random } from "../random.js";

const RP_ID = "kippu.example";

export const testingSuite: Suite = ({ describe, it }) => {
  describe("T-003-07 software signers", () => {
    const profile = createProfileV0({ rpId: RP_ID });
    const credentials = [
      ["softwareP256Signer", softwareP256Signer()],
      ["simulatedWebAuthnSigner", simulatedWebAuthnSigner({ rpId: RP_ID })],
    ] as const;

    for (const [name, credential] of credentials) {
      it(`${name} signs every command kind, and the profile verifies each`, async () => {
        const random = new Random(name.length);
        const registered = profile.registrationAccount(credential.registration);
        assert(registered.ok, "its registration is accepted");
        assertEqual(registered.value.account, credential.signer.account);
        for (const kind of Object.keys(COMMAND_INDEX) as CommandKind[]) {
          const payload = profile.encodeCommand(random.command(kind));
          const authorisation = await credential.signer.sign(payload);
          const claimed = profile.accountOf(authorisation);
          assert(claimed.ok && claimed.value.account === credential.signer.account, kind);
          assert(profile.verify(credential.registration, payload, authorisation), kind);
        }
      });
    }

    it("fresh credentials are distinct accounts", () => {
      const [p, q] = [softwareP256Signer(), softwareP256Signer()];
      assert(p.signer.account !== q.signer.account);
      const a = simulatedWebAuthnSigner({ rpId: RP_ID });
      const b = simulatedWebAuthnSigner({ rpId: RP_ID });
      assert(a.signer.account !== b.signer.account && a.userId !== b.userId);
    });

    it("a second simulated device for one user id shares the account", () => {
      const first = simulatedWebAuthnSigner({ rpId: RP_ID });
      const second = simulatedWebAuthnSigner({ rpId: RP_ID, userId: first.userId });
      const one = profile.registrationAccount(first.registration);
      const two = profile.registrationAccount(second.registration);
      assert(one.ok && two.ok);
      assertEqual(one.value.account, two.value.account);
      assert(one.value.credential !== two.value.credential);
    });
  });
};
