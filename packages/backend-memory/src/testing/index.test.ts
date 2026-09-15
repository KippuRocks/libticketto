// T-005-05: test controls under /testing (REQ-SDK-7; features/005-backend-memory/plan.md §5.4).

import type { TestBackend } from "@ticketto/conformance";
import { DEFAULT_MAX_CLOCK_SKEW, DEFAULT_MAX_RECORDING_LAG } from "@ticketto/ledger-rules";
import { createProfileV0 } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import { createTicketto, type Sponsorship } from "@ticketto/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createControlledClock,
  createTestMemoryBackend,
  seededRandomBytes,
  TEST_EPOCH,
} from "./index.js";

const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x11) });
const profile = createProfileV0({ rpId: "backend-memory.ticketto.test" });

describe("in-memory backend: test controls", () => {
  it("REQ-SDK-7: offers the conformance suite's TestControls", () => {
    expectTypeOf(createTestMemoryBackend).returns.toExtend<TestBackend>();
    const backend: TestBackend = createTestMemoryBackend({ profile });
    expect(backend.clock.now()).toBe(TEST_EPOCH);
  });

  it("reports the gate parameters the rules run with (features/004-conformance/plan.md §5.2b)", () => {
    const backend = createTestMemoryBackend({ profile });
    expect(backend.maxRecordingLag).toBe(DEFAULT_MAX_RECORDING_LAG);
    expect(backend.maxClockSkew).toBe(DEFAULT_MAX_CLOCK_SKEW);
  });

  it("starts the clock at a fixed time, and moves it only forward", () => {
    const clock = createControlledClock();
    expect(clock.now()).toBe(TEST_EPOCH);
    clock.advance(500);
    expect(clock.now()).toBe(TEST_EPOCH + 500);
    clock.set(TEST_EPOCH + 1_000);
    expect(clock.now()).toBe(TEST_EPOCH + 1_000);
    clock.set(TEST_EPOCH + 1_000);
    expect(() => clock.set(TEST_EPOCH + 999)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(0.5)).toThrow(RangeError);
    expect(clock.now()).toBe(TEST_EPOCH + 1_000);
  });

  it("ERR-OperationExpired: the rules read the controlled clock, so advancing it expires an envelope", async () => {
    const backend = createTestMemoryBackend({ profile });
    const ticketto = createTicketto({
      backend,
      profile,
      sponsor: { sponsor: async () => ({ ok: true, value: new Uint8Array() as Sponsorship }) },
      operationLifetime: 60_000,
      now: () => backend.clock.now(),
      randomBytes: (length) => backend.randomBytes(length),
    });
    const input = { salt: new Uint8Array(32), zones: [], capacity: null, metadata: null };
    // Signed now, landing after its lifetime: the envelope check fires before any other.
    const late = ticketto.createEvent(organiser.signer, input).submission;
    backend.clock.advance(60_001);
    const result = await late;
    expect(result.ok ? null : result.error.code).toBe("ERR-OperationExpired");
  });

  it("yields the same random sequence for the same seed, and a different one for another", () => {
    const a = seededRandomBytes(7);
    const b = seededRandomBytes(7);
    const c = seededRandomBytes(8);
    const fromA = [a(16), a(5), a(32)];
    expect([b(16), b(5), b(32)]).toEqual(fromA);
    expect(c(16)).not.toEqual(fromA[0]);
    expect(fromA[0]).not.toEqual(a(16));
    const ids = new Set(Array.from({ length: 10_000 }, () => a(16).join(",")));
    expect(ids.size).toBe(10_000);
  });

  it("makes backends that replay the same randomness for the same seed", () => {
    const one = createTestMemoryBackend({ profile, seed: 3 });
    const two = createTestMemoryBackend({ profile, seed: 3 });
    expect(one.randomBytes(16)).toEqual(two.randomBytes(16));
    expect(one.clock.now()).toBe(TEST_EPOCH);
    expect(createTestMemoryBackend({ profile, start: 5 }).clock.now()).toBe(5);
  });
});
