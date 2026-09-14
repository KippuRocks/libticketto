// T-003-05 — access pass codec, production, and signature-and-window
// verification (REQ-AP-1–REQ-AP-5, NFR-3, NFR-5).

import type { AccessPass, PassId, SignedAccessPass } from "@ticketto/sdk";
import { concatBytes, fromHex } from "../../src/bytes.js";
import {
  DEFAULT_PASS_WINDOW,
  decodePass,
  encodePass,
  encodeSignedPass,
  PASS_LENGTH,
  producePass,
  verifyPass,
} from "../../src/pass.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { Random } from "../random.js";
import { p256Credential, type TestCredential, webAuthnCredential } from "../signers.js";

const CONFIG = { rpId: "kippu.example" };
const T0 = 1_760_000_000_000;
const at = (now: number) => ({ now: () => now });

function code(result: { ok: boolean; error?: { code: string } }): string | null {
  return result.ok ? null : (result.error?.code ?? null);
}

export const passSuite: Suite = ({ describe, it }) => {
  describe("T-003-05 access pass codec", () => {
    it("an access pass is 97 bytes: version, ticket, holder, pass id, notBefore, notAfter", () => {
      const random = new Random(0x9a55);
      const pass: AccessPass = {
        ticket: random.ticketId(),
        holder: random.accountId(),
        id: random.hex<PassId>(16),
        notBefore: T0,
        notAfter: T0 + DEFAULT_PASS_WINDOW,
      };
      const bytes = encodePass(pass);
      assertEqual(bytes.length, PASS_LENGTH);
      assertEqual(bytes[0], 0);
      assertEqual(bytes.subarray(1, 33), fromHex(pass.ticket));
      assertEqual(bytes.subarray(33, 65), fromHex(pass.holder));
      assertEqual(bytes.subarray(65, 81), fromHex(pass.id));
    });

    it("signed passes round-trip; anything else is ERR-InvalidPass", () => {
      const random = new Random(0x51);
      for (let run = 0; run < 100; run++) {
        const signed: SignedAccessPass = {
          pass: {
            ticket: random.ticketId(),
            holder: random.accountId(),
            id: random.hex<PassId>(16),
            notBefore: random.timestamp(),
            notAfter: random.timestamp(),
          },
          authorisation: random.bytes(random.below(600)) as SignedAccessPass["authorisation"],
        };
        const bytes = encodeSignedPass(signed);
        assertEqual(decodePass(bytes), { ok: true, value: signed });
        assertEqual(code(decodePass(concatBytes(bytes, Uint8Array.of(0)))), "ERR-InvalidPass");
        assertEqual(
          code(decodePass(bytes.subarray(0, random.below(bytes.length)))),
          "ERR-InvalidPass",
        );
        const versioned = bytes.slice();
        versioned[0] = 1;
        assertEqual(code(decodePass(versioned)), "ERR-InvalidPass");
      }
    });
  });

  const kinds: [string, (random: Random) => TestCredential][] = [
    ["pass-webauthn", (random) => webAuthnCredential(random, CONFIG.rpId)],
    ["p256", p256Credential],
  ];

  for (const [kind, credential] of kinds) {
    describe(`T-003-05 access passes signed by ${kind}`, () => {
      const random = new Random(kind.length * 7_919);
      const holder = credential(random);
      const other = credential(random);
      const ticket = random.ticketId();

      it("AC-E1.1: a pass is signed by the holder and bounded by NFR-5's 60 s window", async () => {
        const signed = await producePass(
          { ticket, holder: holder.signer.account, notBefore: T0 },
          holder.signer,
        );
        assertEqual(signed.pass.notAfter - signed.pass.notBefore, 60_000);
        assertEqual(signed.pass.holder, holder.signer.account);
        assertEqual(signed.pass.id.length, 32, "a 128-bit pass id");
        const presented = decodePass(encodeSignedPass(signed));
        assert(presented.ok, "the presented bytes decode");
        assertEqual(verifyPass(presented.value, holder.registration, at(T0 + 30_000), CONFIG), {
          ok: true,
          value: signed.pass,
        });
      });

      it("AC-E1.2: a pass signed by a non-holder is rejected", async () => {
        // The pass names the holder, but another account's credential signs it.
        const pass: AccessPass = {
          ticket,
          holder: holder.signer.account,
          id: random.hex<PassId>(16),
          notBefore: T0,
          notAfter: T0 + 60_000,
        };
        const forged = { pass, authorisation: await other.signer.sign(encodePass(pass)) };
        for (const registration of [holder.registration, other.registration]) {
          assertEqual(code(verifyPass(forged, registration, at(T0), CONFIG)), "ERR-InvalidPass");
        }
      });

      it("a pass verified against another credential's registration is ERR-InvalidPass", async () => {
        const signed = await producePass(
          { ticket, holder: holder.signer.account, notBefore: T0 },
          holder.signer,
        );
        assertEqual(
          code(verifyPass(signed, other.registration, at(T0), CONFIG)),
          "ERR-InvalidPass",
        );
      });

      it("REQ-AP-2: a pass cannot be moved to another ticket, holder or window", async () => {
        const signed = await producePass(
          { ticket, holder: holder.signer.account, notBefore: T0 },
          holder.signer,
        );
        const moved: AccessPass[] = [
          { ...signed.pass, ticket: random.ticketId() },
          { ...signed.pass, id: random.hex<PassId>(16) },
          { ...signed.pass, notAfter: signed.pass.notAfter + 1 },
          { ...signed.pass, notBefore: signed.pass.notBefore - 1 },
        ];
        for (const pass of moved) {
          const result = verifyPass({ ...signed, pass }, holder.registration, at(T0), CONFIG);
          assertEqual(code(result), "ERR-InvalidPass");
        }
      });

      it("ERR-PassExpired: a pass outside its window fails; its edges are inside", async () => {
        const signed = await producePass(
          { ticket, holder: holder.signer.account, notBefore: T0, window: 5_000 },
          holder.signer,
        );
        const check = (now: number) =>
          code(verifyPass(signed, holder.registration, at(now), CONFIG));
        assertEqual(check(T0 + 5_001), "ERR-PassExpired", "after notAfter");
        assertEqual(check(T0 - 1), "ERR-PassExpired", "before notBefore");
        assertEqual(check(T0), null, "at notBefore");
        assertEqual(check(T0 + 5_000), null, "at notAfter");
      });

      it("REQ-AP-4: distinct passes for one ticket are distinguishable", async () => {
        const request = { ticket, holder: holder.signer.account, notBefore: T0 };
        const a = await producePass({ ...request, id: random.hex<PassId>(16) }, holder.signer);
        const b = await producePass({ ...request, id: random.hex<PassId>(16) }, holder.signer);
        assert(a.pass.id !== b.pass.id, "distinct ids");
        assert(verifyPass(a, holder.registration, at(T0), CONFIG).ok);
        assert(verifyPass(b, holder.registration, at(T0), CONFIG).ok);
      });
    });
  }

  describe("T-003-05 pass production", () => {
    it("refuses a signer that is not the pass's holder (REQ-AP-1)", async () => {
      const random = new Random(0x71);
      const holder = p256Credential(random);
      const other = p256Credential(random);
      let refused = false;
      try {
        await producePass(
          { ticket: random.ticketId(), holder: holder.signer.account, notBefore: T0 },
          other.signer,
        );
      } catch (error) {
        refused = error instanceof TypeError;
      }
      assert(refused, "production refuses");
    });
  });
};
