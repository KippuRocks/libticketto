/// <reference types="node" />
// Follow-up to T-006-01: the log's decoders must read a byte view where it
// starts, not at offset 0 of its underlying memory. Node allocates small
// `Buffer`s as views into a shared pool, and `Buffer#slice` returns another view
// rather than a copy, so a decoder that built a `DataView` over `.buffer` from 0
// misread every `u64` for callers outside the workspace (kippu-api's log reader,
// ticketto-offchain).
//
// Each C7 vector is decoded from a view in the middle of a larger pool, with
// other bytes on both sides, and must give what the plain bytes give.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { concatBytes, fromHex } from "./bytes.js";
import {
  decodeCheckpoint,
  decodeRecord,
  encodeExport,
  hashRecordBytes,
  operationDigest,
  readExport,
  verifyChain,
} from "./index.js";

interface Vectors {
  records: { bytes: string; hash: string }[];
  checkpoint: { bytes: string };
  invalidCheckpoints: { name: string; bytes: string }[];
  chains: {
    name: string;
    records: string[];
    checkpoints: { sequence: number; headHash: string }[];
  }[];
  operationDigests: { name: string; record: number; digest: string }[];
  malformedRecords: { name: string; bytes: string }[];
}

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "vectors", "v0.json"), "utf8"),
) as Vectors;

/** `bytes` as a `Buffer` view at a non-zero offset of a larger pool, padded both sides. */
function pooled(bytes: Uint8Array | string): Buffer {
  const plain = typeof bytes === "string" ? fromHex(bytes) : bytes;
  const pool = Buffer.alloc(plain.length + 64, 0xa5);
  const view = pool.subarray(29, 29 + plain.length);
  view.set(plain);
  return view;
}

describe("follow-up to T-006-01: C7 decoders read Buffer views from their offset", () => {
  it("the views really are offset into a larger pool", () => {
    const view = pooled("0102");
    expect(view.byteOffset).toBe(29);
    expect(view.buffer.byteLength).toBeGreaterThan(view.length);
  });

  it("records decode, hash and digest as their plain bytes do", () => {
    for (const { bytes, hash } of vectors.records) {
      const decoded = decodeRecord(pooled(bytes));
      expect(decoded).toEqual(decodeRecord(fromHex(bytes)));
      expect(hashRecordBytes(pooled(bytes))).toBe(hash);
    }
    for (const { name, record, digest } of vectors.operationDigests) {
      const decoded = decodeRecord(pooled(vectors.records[record]?.bytes ?? ""));
      expect(
        Buffer.from(operationDigest(decoded.input, decoded.presentedAt)).toString("hex"),
        name,
      ).toBe(digest);
    }
  });

  it("checkpoints decode as their plain bytes do", () => {
    for (const bytes of [
      vectors.checkpoint.bytes,
      ...vectors.invalidCheckpoints.map((c) => c.bytes),
    ]) {
      let plain: unknown;
      try {
        plain = decodeCheckpoint(fromHex(bytes));
      } catch (error) {
        plain = String(error);
      }
      let viewed: unknown;
      try {
        viewed = decodeCheckpoint(pooled(bytes));
      } catch (error) {
        viewed = String(error);
      }
      expect(viewed).toEqual(plain);
    }
  });

  it("chains verify as their plain bytes do, and malformed records are still refused", () => {
    for (const chain of vectors.chains) {
      expect(
        verifyChain(chain.records.map(pooled), undefined, chain.checkpoints),
        chain.name,
      ).toEqual(
        verifyChain(
          chain.records.map((r) => fromHex(r)),
          undefined,
          chain.checkpoints,
        ),
      );
    }
    for (const { name, bytes } of vectors.malformedRecords) {
      expect(() => decodeRecord(pooled(bytes)), name).toThrow();
    }
  });

  it("an export streamed as Buffer views reads as the plain export does", async () => {
    // The sample log up to its checkpoint, with an empty snapshot: a valid export.
    const checkpoint = decodeCheckpoint(fromHex(vectors.checkpoint.bytes));
    const bytes = concatBytes(
      ...encodeExport({
        records: vectors.records.slice(0, checkpoint.sequence + 1).map((r) => fromHex(r.bytes)),
        checkpoint,
        snapshot: {
          events: [],
          tickets: [],
          credentials: [],
          cancellationHolders: [],
          consumedPasses: [],
          operations: [],
        },
      }),
    );
    async function* views(size: number): AsyncIterable<Uint8Array> {
      for (let i = 0; i < bytes.length; i += size) yield pooled(bytes.slice(i, i + size));
    }
    async function* plain(): AsyncIterable<Uint8Array> {
      yield bytes;
    }
    const expected = await readExport(plain());
    expect(expected.ok).toBe(true);
    for (const size of [1, 5, 97, bytes.length])
      expect(await readExport(views(size))).toEqual(expected);
  });
});
