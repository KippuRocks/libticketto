// T-003-09 — access pass size and verification time, for `pass-webauthn` and,
// for comparison, `ed25519` (NFR-1, AD-10, AD-23). Portable: runs on Node and
// under the Hermes VM.
//
// `ed25519` is not a V0 credential kind. It is AD-10's fallback B, measured
// here with the same pass and the same envelope shape — version, kind, 32-byte
// public key, 64-byte signature — so that the two can be compared.

import { ed25519 } from "@noble/curves/ed25519.js";
import type { PassId, SignedAccessPass } from "@ticketto/sdk";
import { concatBytes, fromHex } from "../../src/bytes.js";
import { boundedBytes, decodeExact } from "../../src/codec/scale.js";
import {
  decodePass,
  encodePass,
  encodeSignedPass,
  PASS_LENGTH,
  verifyPass,
} from "../../src/pass.js";
import { Random } from "../random.js";
import { webAuthnCredential } from "../signers.js";
import { qrVersionM } from "./qr.js";

export interface BenchResult {
  readonly kind: "pass-webauthn" | "ed25519";
  /** The pass the holder signs, version byte included. */
  readonly passBytes: number;
  /** The authorisation, as carried in the signed pass. */
  readonly authorisationBytes: number;
  /** The presented signed pass: what the QR code carries. Largest over the sampled passes. */
  readonly signedPassBytes: number;
  /** Smallest over the sampled passes: DER signatures vary by a few bytes. */
  readonly signedPassBytesMin: number;
  /** QR version for the largest sampled pass. */
  readonly qrVersionM: number | null;
  /** Mean time to decode the presented bytes and verify signature and window. */
  readonly verifyMeanMs: number;
  readonly iterations: number;
}

export interface BenchOptions {
  readonly now: () => number;
  readonly iterations: number;
  readonly warmup: number;
}

const RP_ID = "kippu.rocks";
const T0 = 1_760_000_000_000;
const SAMPLES = 64;

function time(options: BenchOptions, body: () => void): number {
  for (let i = 0; i < options.warmup; i++) body();
  const start = options.now();
  for (let i = 0; i < options.iterations; i++) body();
  return (options.now() - start) / options.iterations;
}

async function passWebAuthn(options: BenchOptions): Promise<BenchResult> {
  const random = new Random(0xbe7c);
  const holder = webAuthnCredential(random, RP_ID);
  const pass = {
    ticket: random.ticketId(),
    holder: holder.signer.account,
    id: random.hex<PassId>(16),
    notBefore: T0,
    notAfter: T0 + 60_000,
  };
  const signed: SignedAccessPass = {
    pass,
    authorisation: await holder.signer.sign(encodePass(pass)),
  };
  const presented = encodeSignedPass(signed);
  const sizes: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const other = { ...pass, id: random.hex<PassId>(16) };
    const auth = await holder.signer.sign(encodePass(other));
    sizes.push(encodeSignedPass({ pass: other, authorisation: auth }).length);
  }
  const clock = { now: () => T0 + 1_000 };
  const verifyMeanMs = time(options, () => {
    const decoded = decodePass(presented);
    if (!decoded.ok || !verifyPass(decoded.value, holder.registration, clock, { rpId: RP_ID }).ok) {
      throw new Error("the benchmark pass does not verify");
    }
  });
  return {
    kind: "pass-webauthn",
    passBytes: PASS_LENGTH,
    authorisationBytes: signed.authorisation.length,
    signedPassBytes: Math.max(...sizes),
    signedPassBytesMin: Math.min(...sizes),
    qrVersionM: qrVersionM(Math.max(...sizes)),
    verifyMeanMs,
    iterations: options.iterations,
  };
}

function ed25519Pass(options: BenchOptions): BenchResult {
  const random = new Random(0xed25);
  const secretKey = random.bytes(32);
  const publicKey = ed25519.getPublicKey(secretKey);
  const pass = {
    ticket: random.ticketId(),
    holder: random.accountId(),
    id: random.hex<PassId>(16),
    notBefore: T0,
    notAfter: T0 + 60_000,
  };
  const payload = encodePass(pass);
  // version 0, a hypothetical kind 2, public key, signature.
  const authorisation = concatBytes(
    Uint8Array.of(0, 2),
    publicKey,
    ed25519.sign(payload, secretKey),
  );
  const presented = concatBytes(payload, boundedBytes.enc(authorisation));
  const now = T0 + 1_000;
  const verifyMeanMs = time(options, () => {
    const signedPass = presented.subarray(0, PASS_LENGTH);
    const auth = decodeExact(boundedBytes, presented.subarray(PASS_LENGTH));
    const ok =
      auth[0] === 0 &&
      auth[1] === 2 &&
      ed25519.verify(auth.subarray(34, 98), signedPass, auth.subarray(2, 34)) &&
      now >= pass.notBefore &&
      now <= pass.notAfter;
    if (!ok || fromHex(pass.holder).length !== 32)
      throw new Error("the benchmark pass does not verify");
  });
  return {
    kind: "ed25519",
    passBytes: PASS_LENGTH,
    authorisationBytes: authorisation.length,
    signedPassBytes: presented.length,
    signedPassBytesMin: presented.length,
    qrVersionM: qrVersionM(presented.length),
    verifyMeanMs,
    iterations: options.iterations,
  };
}

export async function runPassBenchmark(options: BenchOptions): Promise<readonly BenchResult[]> {
  return [await passWebAuthn(options), ed25519Pass(options)];
}
