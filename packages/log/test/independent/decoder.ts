// An independent decoder of the C7 formats, written from FORMAT.md alone.
//
// It deliberately imports nothing from this package or any other @ticketto
// package: only general-purpose BLAKE2b and P-256 implementations. A test checks
// that. If the vectors decode and verify here, FORMAT.md says enough to
// reproduce them.

import { p256 } from "@noble/curves/nist.js";
import { blake2b } from "@noble/hashes/blake2.js";

export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const unhex = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const tag = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const blake2b256 = (data: Uint8Array): Uint8Array => blake2b(data, { dkLen: 32 });

class Cursor {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new Error("short");
    const out = this.bytes.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0] as number;
  }
  u64(): bigint {
    const b = this.take(8);
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i] as number);
    return v;
  }
  compact(): number {
    const b0 = this.u8();
    switch (b0 & 3) {
      case 0:
        return b0 >> 2;
      case 1: {
        const v = (b0 | (this.u8() << 8)) >> 2;
        if (v < 64) throw new Error("non-canonical");
        return v;
      }
      case 2: {
        const b = this.take(3);
        const v =
          (b0 +
            (b[0] as number) * 256 +
            (b[1] as number) * 65536 +
            (b[2] as number) * 16777216 -
            2) /
          4;
        if (v < 16384) throw new Error("non-canonical");
        return v;
      }
      default: {
        const n = (b0 >> 2) + 4;
        const b = this.take(n);
        let v = 0n;
        for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i] as number);
        if (b[n - 1] === 0 || v < 1n << 30n) throw new Error("non-canonical");
        return Number(v);
      }
    }
  }
  vec(): Uint8Array {
    return this.take(this.compact());
  }
  option<T>(read: () => T): T | null {
    const t = this.u8();
    if (t === 0) return null;
    if (t === 1) return read();
    throw new Error("bad option");
  }
  done(): void {
    if (this.at !== this.bytes.length) throw new Error("trailing");
  }
}

// §2 Records.

export interface DecodedRecord {
  sequence: number;
  event: { id: string; sequence: number } | null;
  recordedAt: number;
  input: { version: number; kind: number; payload: string; authorisation: string; framed: string };
  presentedAt: number | null;
  prevHash: string;
}

const num = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("too large for this decoder");
  return Number(v);
};

/** The fields of a record's bytes (§2.1, §2.2); throws for anything that is not one. */
export function decodeRecord(bytes: Uint8Array): DecodedRecord {
  const c = new Cursor(bytes);
  if (c.u8() !== 0) throw new Error("record version");
  const sequence = num(c.u64());
  const event = c.option(() => ({ id: hex(c.take(32)), sequence: num(c.u64()) }));
  const recordedAt = num(c.u64());
  const start = c.at;
  const version = c.u8();
  const kind = c.u8();
  if (version !== 0) throw new Error("signed input version");
  if (kind !== 0 && kind !== 1) throw new Error("signed input kind");
  const payload = hex(c.vec());
  const authorisation = hex(c.vec());
  const framed = hex(bytes.slice(start, c.at));
  const presentedAt = c.option(() => num(c.u64()));
  const prevHash = hex(c.take(32));
  c.done();
  // §2.1 constraints. A command names its event, if any, in its payload; that
  // payload is C2's, so only what this format itself states is checked here.
  if (kind === 1 && event === null) throw new Error("a pass names an event");
  if (kind === 0 && presentedAt !== null) throw new Error("a command carries no presentedAt");
  return {
    sequence,
    event,
    recordedAt,
    input: { version, kind, payload, authorisation, framed },
    presentedAt,
    prevHash,
  };
}

/** §2.3 */
export const recordHash = (bytes: Uint8Array): string =>
  hex(blake2b256(cat(tag("ticketto/v0/log"), bytes)));

// §3 and §4.3: the chain, against held checkpoints.

export type Outcome = { ok: true } | { ok: false; sequence: number; fault: string };

export function verifyLog(
  records: Uint8Array[],
  checkpoints: { sequence: number; headHash: string }[],
): Outcome {
  let previous = "00".repeat(32);
  const nextOfEvent = new Map<string, number>();
  let expected = 0;
  for (const bytes of records) {
    let r: DecodedRecord;
    try {
      r = decodeRecord(bytes);
    } catch {
      return { ok: false, sequence: expected, fault: "malformed" };
    }
    if (r.sequence !== expected) return { ok: false, sequence: expected, fault: "sequence" };
    if (r.prevHash !== previous) return { ok: false, sequence: expected, fault: "link" };
    if (r.event !== null) {
      if (r.event.sequence !== (nextOfEvent.get(r.event.id) ?? 0)) {
        return { ok: false, sequence: expected, fault: "eventSequence" };
      }
      nextOfEvent.set(r.event.id, r.event.sequence + 1);
    }
    previous = recordHash(bytes);
    if (checkpoints.some((c) => c.sequence === expected && c.headHash !== previous)) {
      return { ok: false, sequence: expected, fault: "checkpoint" };
    }
    expected++;
  }
  if (checkpoints.some((c) => c.sequence >= expected)) {
    return { ok: false, sequence: expected, fault: "truncated" };
  }
  return { ok: true };
}

// §4 Checkpoints.

export interface DecodedCheckpoint {
  sequence: number;
  headHash: string;
  issuedAt: number;
  signingPayload: string;
  authorisation: string;
}

export function decodeCheckpoint(bytes: Uint8Array): DecodedCheckpoint {
  const c = new Cursor(bytes);
  if (c.u8() !== 0) throw new Error("checkpoint version");
  const sequence = num(c.u64());
  const headHash = hex(c.take(32));
  const issuedAt = num(c.u64());
  const signed = bytes.slice(0, c.at);
  const authorisation = hex(c.vec());
  c.done();
  return {
    sequence,
    headHash,
    issuedAt,
    signingPayload: hex(cat(tag("ticketto/v0/checkpoint"), signed)),
    authorisation,
  };
}

function p256Credential(bytes: Uint8Array): { publicKey: Uint8Array; signature: Uint8Array } {
  if (bytes.length !== 99 || bytes[0] !== 0 || bytes[1] !== 1) throw new Error("not p256");
  return { publicKey: bytes.slice(2, 35), signature: bytes.slice(35) };
}

const ecdsa = (signature: Uint8Array, digest: Uint8Array, publicKey: Uint8Array): boolean =>
  p256.verify(signature, digest, publicKey, { prehash: false, lowS: true });

/** §4.2: whether checkpoint `bytes` verify against the publication key's `registration`. */
export function checkpointValid(bytes: Uint8Array, registration: Uint8Array): boolean {
  try {
    const checkpoint = decodeCheckpoint(bytes);
    const reg = p256Credential(registration);
    const auth = p256Credential(unhex(checkpoint.authorisation));
    if (hex(reg.publicKey) !== hex(auth.publicKey)) return false;
    p256.Point.fromBytes(reg.publicKey).assertValidity();
    const regDigest = blake2b256(cat(tag("ticketto/v0/registration/p256"), reg.publicKey));
    return (
      ecdsa(reg.signature, regDigest, reg.publicKey) &&
      ecdsa(auth.signature, blake2b256(unhex(checkpoint.signingPayload)), auth.publicKey)
    );
  } catch {
    return false;
  }
}
