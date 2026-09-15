/// <reference types="node" />
// T-006-06 — the C7 vectors: checked against the package, and reproduced by an
// independent decoder written from FORMAT.md alone (REQ-TM-3).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Registration } from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import * as independent from "../test/independent/decoder.js";
import { buildVectors, type Json } from "../test/vectors.js";
import { fromHex, toHex } from "./bytes.js";
import {
  decodeCheckpoint,
  decodeRecord,
  hashRecordBytes,
  operationDigest,
  verifyChain,
  verifyCheckpoint,
} from "./index.js";

const path = join(import.meta.dirname, "..", "vectors", "v0.json");

interface Vectors {
  publicationRegistration: string;
  records: { record: Record<string, unknown>; bytes: string; hash: string }[];
  head: { next: number; hash: string; eventSequences: Record<string, number> };
  checkpoint: { bytes: string; sequence: number; headHash: string; signingPayload: string };
  invalidCheckpoints: { name: string; bytes: string }[];
  chains: {
    name: string;
    records: string[];
    checkpoints: { sequence: number; headHash: string }[];
    expected: { ok: boolean; sequence?: number; fault?: string };
  }[];
  malformedRecords: { name: string; bytes: string }[];
  operationDigests: { name: string; record: number; digest: string }[];
}

// `pnpm vectors:generate` rewrites the file; every other run checks it.
if (process.env.TICKETTO_WRITE_VECTORS !== undefined) {
  describe("T-006-06 vector generation", () => {
    it("writes vectors/v0.json", async () => {
      writeFileSync(path, `${JSON.stringify(await buildVectors(), null, 2)}\n`);
    });
  });
} else {
  const vectors = JSON.parse(readFileSync(path, "utf8")) as Vectors;
  const registration = fromHex(vectors.publicationRegistration) as Registration;

  describe("T-006-06 the checked-in vectors", () => {
    let generated: Json;
    beforeAll(async () => {
      generated = await buildVectors();
    });

    it("are exactly what the current code generates", () => {
      expect(JSON.parse(JSON.stringify(generated))).toEqual(vectors);
    });

    it("decode and hash through the package", () => {
      for (const { bytes, hash, record } of vectors.records) {
        const decoded = decodeRecord(fromHex(bytes));
        expect(decoded.sequence).toBe(record.sequence);
        expect(decoded.prevHash).toBe(record.prevHash);
        expect(hashRecordBytes(fromHex(bytes))).toBe(hash);
      }
    });

    it("reproduce every chain result through the package", () => {
      for (const chain of vectors.chains) {
        const result = verifyChain(
          chain.records.map((r) => fromHex(r)),
          undefined,
          chain.checkpoints,
        );
        const outcome = result.ok
          ? { ok: true }
          : { ok: false, sequence: result.sequence, fault: result.fault };
        expect(outcome, chain.name).toEqual(chain.expected);
      }
    });

    it("verify the checkpoint, and refuse the invalid ones, through the package", () => {
      expect(
        verifyCheckpoint(decodeCheckpoint(fromHex(vectors.checkpoint.bytes)), registration),
      ).toBe(true);
      for (const { name, bytes } of vectors.invalidCheckpoints) {
        let valid: boolean;
        try {
          valid = verifyCheckpoint(decodeCheckpoint(fromHex(bytes)), registration);
        } catch {
          valid = false;
        }
        expect(valid, name).toBe(false);
      }
    });

    it("reproduce every operation digest through the package", () => {
      expect(vectors.operationDigests.map((v) => v.name)).toContain("a signed access pass");
      for (const { name, record, digest } of vectors.operationDigests) {
        const decoded = decodeRecord(fromHex(vectors.records[record]?.bytes ?? ""));
        expect(toHex(operationDigest(decoded.input, decoded.presentedAt)), name).toBe(digest);
      }
    });

    it("refuse every malformed record through the package", () => {
      for (const { name, bytes } of vectors.malformedRecords) {
        expect(() => decodeRecord(fromHex(bytes)), name).toThrow();
      }
    });
  });

  describe("REQ-TM-3 an independent decoder written from FORMAT.md reproduces the vectors", () => {
    it("imports nothing from this package or any other @ticketto package", () => {
      const source = readFileSync(
        join(import.meta.dirname, "..", "test", "independent", "decoder.ts"),
        "utf8",
      );
      const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(specifiers.sort()).toEqual(["@noble/curves/nist.js", "@noble/hashes/blake2.js"]);
    });

    it("decodes every record to its stated fields and hash", () => {
      for (const { bytes, hash, record } of vectors.records) {
        expect(independent.decodeRecord(independent.unhex(bytes))).toEqual(record);
        expect(independent.recordHash(independent.unhex(bytes))).toBe(hash);
      }
    });

    it("reproduces every chain result", () => {
      for (const chain of vectors.chains) {
        const outcome = independent.verifyLog(
          chain.records.map(independent.unhex),
          chain.checkpoints,
        );
        expect(outcome, chain.name).toEqual(chain.expected);
      }
    });

    it("reproduces the sample log's head", () => {
      const last = vectors.records.at(-1);
      expect(vectors.head.next).toBe(vectors.records.length);
      expect(vectors.head.hash).toBe(last?.hash);
    });

    it("accepts the checkpoint and refuses the invalid ones", () => {
      const reg = independent.unhex(vectors.publicationRegistration);
      const bytes = independent.unhex(vectors.checkpoint.bytes);
      expect(independent.checkpointValid(bytes, reg)).toBe(true);
      const decoded = independent.decodeCheckpoint(bytes);
      expect(decoded).toMatchObject({
        sequence: vectors.checkpoint.sequence,
        headHash: vectors.checkpoint.headHash,
        signingPayload: vectors.checkpoint.signingPayload,
      });
      for (const { name, bytes: invalid } of vectors.invalidCheckpoints) {
        expect(independent.checkpointValid(independent.unhex(invalid), reg), name).toBe(false);
      }
    });

    it("reproduces every operation digest", () => {
      for (const { name, record, digest } of vectors.operationDigests) {
        const bytes = independent.unhex(vectors.records[record]?.bytes ?? "");
        expect(independent.operationDigest(independent.decodeRecord(bytes)), name).toBe(digest);
      }
    });

    it("refuses every malformed record", () => {
      for (const { name, bytes } of vectors.malformedRecords) {
        expect(() => independent.decodeRecord(independent.unhex(bytes)), name).toThrow();
      }
    });
  });
}
