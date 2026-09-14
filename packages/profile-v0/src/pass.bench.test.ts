/// <reference types="node" />
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { runPassBenchmark } from "../test/bench/pass.bench.js";
import { BYTE_CAPACITY_M, qrVersionM } from "../test/bench/qr.js";

describe("T-003-09 QR capacity table", () => {
  it("matches the qrcode package at every version boundary, byte mode, level M", () => {
    BYTE_CAPACITY_M.forEach((capacity, index) => {
      const version = (bytes: number) =>
        QRCode.create([{ data: new Uint8Array(bytes), mode: "byte" }], {
          errorCorrectionLevel: "M",
        }).version;
      expect(version(capacity)).toBe(index + 1);
      expect(qrVersionM(capacity)).toBe(index + 1);
      if (index < 39) expect(version(capacity + 1)).toBe(index + 2);
    });
  });
});

// `BENCH=1 pnpm --filter @ticketto/profile-v0 bench` prints the Node numbers;
// test/hermes/run.ts bench prints Hermes'. Skipped in ordinary test runs.
describe.skipIf(process.env.BENCH === undefined)("T-003-09 pass benchmark on Node", () => {
  it("reports size, QR version and verification time for both kinds", async () => {
    const results = await runPassBenchmark({
      now: () => performance.now(),
      iterations: 1_000,
      warmup: 100,
    });
    for (const result of results) {
      console.log(`BENCH ${JSON.stringify({ runtime: `node ${process.version}`, ...result })}`);
      expect(result.qrVersionM).not.toBeNull();
    }
  }, 120_000);
});
