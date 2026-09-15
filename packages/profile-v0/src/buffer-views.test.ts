/// <reference types="node" />
// Follow-up to T-006-01: every decoder must read a byte view where it starts,
// not at offset 0 of its underlying memory. Node allocates small `Buffer`s as
// views into a shared pool, and `Buffer#slice` returns another view rather than
// a copy, so a decoder that assumed `.buffer` begins with its input misread
// integers and lengths for callers outside the workspace (kippu-api,
// ticketto-offchain). Node only: Hermes has no `Buffer`.
//
// Each C2 vector is decoded from a view in the middle of a larger pool, with
// other bytes on both sides, and must give what the plain bytes give.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Authorisation, Registration } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { fromHex } from "./bytes.js";
import {
  accountOf,
  createProfileV0,
  decodeCommand,
  decodePass,
  decodeSignedAccessPass,
  decodeSignedCommand,
  registrationAccount,
  verifyPass,
  verifyProofOfControl,
} from "./index.js";

interface Vectors {
  rpId: string;
  credentials: { name: string; registration: string }[];
  commands: { name: string; bytes: string }[];
  authorisations: {
    name: string;
    registration: string;
    payload: string;
    authorisation: string;
    valid: boolean;
  }[];
  signedPasses: { name: string; bytes: string; registration: string; now: number }[];
  signedInputs: { name: string; kind: "command" | "accessPass"; bytes: string }[];
  malformed: { name: string; kind: string; bytes: string }[];
  proofsOfControl: {
    name: string;
    challenge: { audience: string; nonce: string; expiresAt: number; account: string };
    authorisation: string;
    registration: string;
    now: number;
  }[];
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "vectors", "v0.json"), "utf8"),
) as Vectors;

/** `hex`'s bytes as a `Buffer` view at a non-zero offset of a larger pool, padded both sides. */
function pooled(hex: string): Buffer {
  const bytes = fromHex(hex);
  const pool = Buffer.alloc(bytes.length + 64, 0xa5);
  const view = pool.subarray(23, 23 + bytes.length);
  view.set(bytes);
  return view;
}

describe("follow-up to T-006-01: C2 decoders read Buffer views from their offset", () => {
  it("the views really are offset into a larger pool", () => {
    const view = pooled("0102");
    expect(view.byteOffset).toBe(23);
    expect(view.buffer.byteLength).toBeGreaterThan(view.length);
  });

  it("commands decode as their plain bytes do", () => {
    for (const { name, bytes } of vectors.commands) {
      expect(decodeCommand(pooled(bytes)), name).toEqual(decodeCommand(fromHex(bytes)));
    }
  });

  it("signed passes and signed inputs decode as their plain bytes do", () => {
    for (const { name, bytes } of vectors.signedPasses) {
      expect(decodePass(pooled(bytes)), name).toEqual(decodePass(fromHex(bytes)));
    }
    for (const { name, kind, bytes } of vectors.signedInputs) {
      const decode = kind === "command" ? decodeSignedCommand : decodeSignedAccessPass;
      const plain = decode(fromHex(bytes));
      expect(plain.ok, name).toBe(true);
      expect(decode(pooled(bytes)), name).toEqual(plain);
    }
  });

  it("registrations and authorisations name the same accounts, and verify as labelled", () => {
    const profile = createProfileV0({ rpId: vectors.rpId });
    for (const { name, registration } of vectors.credentials) {
      expect(registrationAccount(pooled(registration) as unknown as Registration), name).toEqual(
        registrationAccount(fromHex(registration) as Registration),
      );
    }
    for (const v of vectors.authorisations) {
      const authorisation = pooled(v.authorisation) as unknown as Authorisation;
      expect(accountOf(authorisation), v.name).toEqual(
        accountOf(fromHex(v.authorisation) as Authorisation),
      );
      expect(
        profile.verify(
          pooled(v.registration) as unknown as Registration,
          pooled(v.payload),
          authorisation,
        ),
        v.name,
      ).toBe(v.valid);
    }
  });

  it("passes and proofs of control verify from views as from plain bytes", () => {
    const config = { rpId: vectors.rpId };
    for (const v of vectors.signedPasses) {
      const decoded = decodePass(pooled(v.bytes));
      if (!decoded.ok) continue;
      const clock = { now: () => v.now };
      expect(
        verifyPass(decoded.value, pooled(v.registration) as unknown as Registration, clock, config),
        v.name,
      ).toEqual(verifyPass(decoded.value, fromHex(v.registration) as Registration, clock, config));
    }
    for (const v of vectors.proofsOfControl) {
      const challenge = { ...v.challenge, account: v.challenge.account as never };
      const viewed = verifyProofOfControl(
        { ...challenge, audience: pooled(v.challenge.audience), nonce: pooled(v.challenge.nonce) },
        pooled(v.authorisation) as unknown as Authorisation,
        pooled(v.registration) as unknown as Registration,
        v.now,
        config,
      );
      const plain = verifyProofOfControl(
        {
          ...challenge,
          audience: fromHex(v.challenge.audience),
          nonce: fromHex(v.challenge.nonce),
        },
        fromHex(v.authorisation) as Authorisation,
        fromHex(v.registration) as Registration,
        v.now,
        config,
      );
      expect(viewed, v.name).toEqual(plain);
    }
  });

  it("malformed bytes are still refused from views", () => {
    for (const { name, kind, bytes } of vectors.malformed) {
      const view = pooled(bytes);
      if (kind === "pass") expect(decodePass(view).ok, name).toBe(false);
      else if (kind === "signedCommand") expect(decodeSignedCommand(view).ok, name).toBe(false);
      else if (kind === "signedAccessPass")
        expect(decodeSignedAccessPass(view).ok, name).toBe(false);
      else expect(() => decodeCommand(view), name).toThrow();
    }
  });
});
