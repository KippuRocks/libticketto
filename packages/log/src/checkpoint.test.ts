// T-006-03 — checkpoints: codec, signing through a Signer, verification (REQ-TM-3).

import { simulatedWebAuthnSigner } from "@ticketto/profile-v0/testing";
import type { Authorisation } from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { holder, publication, sampleEntries } from "../test/fixtures.js";
import { ascii, concatBytes } from "./bytes.js";
import {
  CHECKPOINT_VERSION,
  type Checkpoint,
  checkpointSigningPayload,
  decodeCheckpoint,
  EMPTY_CHAIN,
  encodeCheckpoint,
  type LinkedRecord,
  LogChain,
  LogDecodeError,
  type LogEntry,
  signCheckpoint,
  statementFor,
  verifyChain,
  verifyCheckpoint,
} from "./index.js";

let entries: LogEntry[];
let linked: LinkedRecord[];
let checkpoint: Checkpoint;
const HELD = 4;

beforeAll(async () => {
  entries = await sampleEntries();
  const chain = new LogChain();
  linked = entries.map((entry) => chain.append(entry));
  checkpoint = await signCheckpoint(
    statementFor(linked[HELD]?.head ?? EMPTY_CHAIN, 1_800_000_100_000),
    publication.signer,
  );
});

/** The log rewritten from `index` on — `change` applied there — and re-linked consistently. */
function rewrittenFrom(index: number, change: Partial<LogEntry>): Uint8Array[] {
  const chain = new LogChain();
  return entries.map(
    (entry, i) => chain.append(i === index ? { ...entry, ...change } : entry).bytes,
  );
}

describe("T-006-03 checkpoint codec", () => {
  it("round-trips", () => {
    const bytes = encodeCheckpoint(checkpoint);
    expect(bytes[0]).toBe(CHECKPOINT_VERSION);
    expect(decodeCheckpoint(bytes)).toEqual(checkpoint);
    expect(checkpoint).toMatchObject({ sequence: HELD, headHash: linked[HELD]?.hash });
  });

  it("refuses non-canonical bytes", () => {
    const bytes = encodeCheckpoint(checkpoint);
    expect(() => decodeCheckpoint(concatBytes(bytes, Uint8Array.of(0)))).toThrow(LogDecodeError);
    for (let cut = 0; cut < bytes.length; cut++) {
      expect(() => decodeCheckpoint(bytes.subarray(0, cut))).toThrow(LogDecodeError);
    }
    const versioned = bytes.slice();
    versioned[0] = CHECKPOINT_VERSION + 1;
    expect(() => decodeCheckpoint(versioned)).toThrow(LogDecodeError);
  });

  it("signs a domain-separated payload", () => {
    const payload = checkpointSigningPayload(checkpoint);
    const tag = ascii("ticketto/v0/checkpoint");
    expect(payload.subarray(0, tag.length)).toEqual(tag);
    // The payload is the tag and the checkpoint's bytes up to its authorisation.
    expect(payload.subarray(tag.length)).toEqual(encodeCheckpoint(checkpoint).subarray(0, 49));
  });

  it("has nothing to checkpoint in an empty log", () => {
    expect(() => statementFor(EMPTY_CHAIN, 0)).toThrow(TypeError);
  });
});

describe("T-006-03 checkpoint verification", () => {
  it("accepts a checkpoint signed by the publication key", () => {
    expect(verifyCheckpoint(checkpoint, publication.registration)).toBe(true);
    expect(
      verifyCheckpoint(decodeCheckpoint(encodeCheckpoint(checkpoint)), publication.registration),
    ).toBe(true);
  });

  it("refuses another key, a changed statement, and a changed signature", () => {
    expect(verifyCheckpoint(checkpoint, holder.registration)).toBe(false);
    expect(verifyCheckpoint({ ...checkpoint, sequence: HELD + 1 }, publication.registration)).toBe(
      false,
    );
    expect(
      verifyCheckpoint({ ...checkpoint, headHash: "00".repeat(32) }, publication.registration),
    ).toBe(false);
    expect(verifyCheckpoint({ ...checkpoint, issuedAt: 1 }, publication.registration)).toBe(false);
    const authorisation = checkpoint.authorisation.slice() as Authorisation;
    authorisation[authorisation.length - 1] = (authorisation.at(-1) as number) ^ 1;
    expect(verifyCheckpoint({ ...checkpoint, authorisation }, publication.registration)).toBe(
      false,
    );
    expect(
      verifyCheckpoint(
        { ...checkpoint, authorisation: new Uint8Array(3) as Authorisation },
        publication.registration,
      ),
    ).toBe(false);
  });

  it("refuses a checkpoint signed by a credential that is not of the p256 kind", async () => {
    const passkey = simulatedWebAuthnSigner({ rpId: "kippu.rocks" });
    const signed = await signCheckpoint(checkpoint, passkey.signer);
    expect(verifyCheckpoint(signed, passkey.registration)).toBe(false);
  });
});

describe("REQ-TM-3 a held checkpoint detects a rewrite", () => {
  it("the published log verifies against it", () => {
    const records = linked.map(({ bytes }) => bytes);
    expect(verifyChain(records, undefined, [checkpoint])).toMatchObject({ ok: true });
  });

  it("a rewrite before the checkpoint, re-linked consistently, is reported at its sequence", () => {
    for (let index = 0; index <= HELD; index++) {
      const rewritten = rewrittenFrom(index, { recordedAt: 1 });
      // Re-linked, the rewritten log passes every check that holds no checkpoint…
      expect(verifyChain(rewritten)).toMatchObject({ ok: true });
      // …but not the checkpoint.
      expect(verifyChain(rewritten, undefined, [checkpoint])).toMatchObject({
        ok: false,
        sequence: HELD,
        fault: "checkpoint",
      });
    }
  });

  it("a rewrite after the checkpoint is beyond what it covers", () => {
    const rewritten = rewrittenFrom(HELD + 1, { recordedAt: 1 });
    expect(verifyChain(rewritten, undefined, [checkpoint])).toMatchObject({ ok: true });
  });

  it("a log cut short before the checkpoint is reported where it ends", () => {
    const records = linked.slice(0, HELD).map(({ bytes }) => bytes);
    expect(verifyChain(records, undefined, [checkpoint])).toMatchObject({
      ok: false,
      sequence: HELD,
      fault: "truncated",
    });
  });

  it("checks a stretch of the log that starts at the checkpoint", () => {
    const state = { head: linked[HELD]?.head ?? EMPTY_CHAIN, eventSequences: new Map() };
    const rest = linked.slice(HELD + 1).map(({ bytes }) => bytes);
    expect(verifyChain(rest, state, [checkpoint])).toMatchObject({ ok: true });
    const forged = { ...state, head: { ...state.head, hash: "11".repeat(32) } };
    expect(verifyChain(rest, forged, [checkpoint])).toMatchObject({
      ok: false,
      sequence: HELD,
      fault: "checkpoint",
    });
  });
});
