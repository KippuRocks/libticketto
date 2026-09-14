// Canonical framing of signed inputs (REQ-CP-1): a signed command or a signed
// access pass as the log and the wire protocol carry it.

import type { Authorisation, PassId, SignedAccessPass, SignedCommand } from "@ticketto/sdk";
import { compact } from "scale-ts";
import { concatBytes } from "../../src/bytes.js";
import { encodeCommand } from "../../src/codec/command.js";
import { encodePass } from "../../src/pass.js";
import {
  decodeSignedAccessPass,
  decodeSignedCommand,
  encodeSignedAccessPass,
  encodeSignedCommand,
  SIGNED_INPUT_KIND_INDEX,
} from "../../src/signed-input.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { Random } from "../random.js";

const compactLength = (n: number): Uint8Array => compact.enc(n);

function code(result: { ok: boolean; error?: { code: string } }): string | null {
  return result.ok ? null : (result.error?.code ?? null);
}

export const signedInputSuite: Suite = ({ describe, it }) => {
  describe("signed input framing", () => {
    const random = new Random(0xf4a3);
    const command = (): SignedCommand => ({
      command: random.command(),
      authorisation: random.bytes(random.below(600)) as Authorisation,
    });
    const pass = (): SignedAccessPass => ({
      pass: {
        ticket: random.ticketId(),
        holder: random.accountId(),
        id: random.hex<PassId>(16),
        notBefore: random.timestamp(),
        notAfter: random.timestamp(),
      },
      authorisation: random.bytes(random.below(600)) as Authorisation,
    });

    it("a signed command is version, kind 0, the command bytes and the authorisation", () => {
      const signed = command();
      const bytes = encodeSignedCommand(signed);
      const payload = encodeCommand(signed.command);
      assertEqual(
        bytes,
        concatBytes(
          Uint8Array.of(0, SIGNED_INPUT_KIND_INDEX.command),
          compactLength(payload.length),
          payload,
          compactLength(signed.authorisation.length),
          signed.authorisation,
        ),
      );
    });

    it("a signed access pass is version, kind 1, the pass bytes and the authorisation", () => {
      const signed = pass();
      const bytes = encodeSignedAccessPass(signed);
      const payload = encodePass(signed.pass);
      assertEqual(
        bytes,
        concatBytes(
          Uint8Array.of(0, SIGNED_INPUT_KIND_INDEX.accessPass),
          compactLength(payload.length),
          payload,
          compactLength(signed.authorisation.length),
          signed.authorisation,
        ),
      );
    });

    it("signed commands and passes round-trip", () => {
      for (let run = 0; run < 100; run++) {
        const c = command();
        assertEqual(decodeSignedCommand(encodeSignedCommand(c)), { ok: true, value: c });
        const p = pass();
        assertEqual(decodeSignedAccessPass(encodeSignedAccessPass(p)), { ok: true, value: p });
      }
    });

    it("anything but the canonical framing is refused", () => {
      for (let run = 0; run < 50; run++) {
        const c = encodeSignedCommand(command());
        const p = encodeSignedAccessPass(pass());
        const invalidCommand = (bytes: Uint8Array, why: string) =>
          assertEqual(code(decodeSignedCommand(bytes)), "ERR-InvalidAuthorisation", why);
        const invalidPass = (bytes: Uint8Array, why: string) =>
          assertEqual(code(decodeSignedAccessPass(bytes)), "ERR-InvalidPass", why);

        invalidCommand(concatBytes(c, Uint8Array.of(0)), "a trailing byte");
        invalidCommand(c.subarray(0, random.below(c.length)), "truncated");
        invalidPass(concatBytes(p, Uint8Array.of(0)), "a trailing byte");
        invalidPass(p.subarray(0, random.below(p.length)), "truncated");
        invalidCommand(p, "a pass is not a command");
        invalidPass(c, "a command is not a pass");
        for (const [bytes, invalid] of [
          [c, invalidCommand],
          [p, invalidPass],
        ] as const) {
          const version = bytes.slice();
          version[0] = 1;
          invalid(version, "an unknown version");
          const kind = bytes.slice();
          kind[1] = 2;
          invalid(kind, "an unknown kind");
        }
      }
    });

    it("a payload that is not canonical is refused", () => {
      const signed = command();
      const payload = concatBytes(encodeCommand(signed.command), Uint8Array.of(0));
      const bytes = concatBytes(
        Uint8Array.of(0, SIGNED_INPUT_KIND_INDEX.command),
        compactLength(payload.length),
        payload,
        compactLength(0),
      );
      assert(!decodeSignedCommand(bytes).ok, "a trailing byte inside the payload");
    });
  });
};
