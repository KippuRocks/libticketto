// @ticketto/backend-memory/testing — test controls, for tests and the
// conformance suite only (T-005-05, features/005-backend-memory/plan.md §5.4,
// REQ-SDK-7). A backend made here runs on a clock the test moves by hand and a
// seeded random source, so time-dependent cases (`AC-B1.4`, `ERR-PassExpired`)
// can be reached, and a failing run replayed.

import {
  type Clock,
  DEFAULT_MAX_CLOCK_SKEW,
  DEFAULT_MAX_PASS_WINDOW,
  DEFAULT_MAX_RECORDING_LAG,
} from "@ticketto/ledger-rules";
import type { Backend, Migration, Profile, Signer, Timestamp } from "@ticketto/sdk";
import { backendOver } from "../backend.js";
import { createMemoryStore } from "../capabilities.js";

/** A clock a test moves by hand. It never moves backwards: the ledger's clock is monotonic (`REQ-SDK-3`). */
export interface ControlledClock extends Clock {
  /** Moves the clock to `time`, which must not be earlier than now. */
  set(time: Timestamp): void;
  /** Moves the clock forward by `ms` milliseconds. */
  advance(ms: number): void;
}

/** The in-memory backend under test controls: the settable clock the rules read, and seeded randomness. */
export interface TestMemoryBackend extends Backend {
  readonly migration: Migration;
  readonly clock: ControlledClock;
  /**
   * Random bytes from a seeded source, for operation and pass ids. Backends made
   * with the same seed yield the same sequence. Not cryptographically secure.
   */
  randomBytes(length: number): Uint8Array;
  /** How long after a pass's `notAfter` the rules still record it, in milliseconds (`AD-13`). */
  readonly maxRecordingLag: number;
  /** How far ahead of the ledger's clock a pass's `presentedAt` may be, in milliseconds. */
  readonly maxClockSkew: number;
  /** The longest window, `notAfter − notBefore`, a pass may carry, in milliseconds (`REQ-AP-3`). */
  readonly maxPassWindow: number;
}

export interface TestMemoryBackendOptions {
  readonly profile: Profile;
  /** Where the clock starts. Defaults to {@link TEST_EPOCH}. */
  readonly start?: Timestamp;
  /** Seeds `randomBytes`. Defaults to 0. */
  readonly seed?: number;
  /** The publication key an export's checkpoint is signed with (`C7` §4). */
  readonly publication?: Signer;
}

/** The default start of a test backend's clock: a fixed time, so runs are reproducible. */
export const TEST_EPOCH: Timestamp = 1_800_000_000_000;

/** A clock that moves only when told to. */
export function createControlledClock(start: Timestamp = TEST_EPOCH): ControlledClock {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new RangeError(`a timestamp is a non-negative safe integer, not ${start}`);
  }
  let current = start;
  const moveTo = (time: Timestamp) => {
    if (!Number.isSafeInteger(time)) {
      throw new RangeError(`a timestamp is a safe integer, not ${time}`);
    }
    if (time < current) throw new RangeError(`the clock is monotonic: ${time} < ${current}`);
    current = time;
  };
  return {
    now: () => current,
    set: moveTo,
    advance: (ms) => {
      if (!Number.isSafeInteger(ms) || ms < 0) {
        throw new RangeError(`the clock advances by a non-negative safe integer, not ${ms}`);
      }
      moveTo(current + ms);
    },
  };
}

/** Seeded random bytes (sfc32). Deterministic for a seed; for test ids only, never for keys. */
export function seededRandomBytes(seed = 0): (length: number) => Uint8Array {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 15; i += 1) next();
  return (length) => {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError(`a length is a non-negative safe integer, not ${length}`);
    }
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 4) {
      let word = next();
      for (let j = i; j < Math.min(i + 4, length); j += 1) {
        bytes[j] = word & 0xff;
        word >>>= 8;
      }
    }
    return bytes;
  };
}

/** A fresh, empty in-memory backend under test controls. */
export function createTestMemoryBackend(options: TestMemoryBackendOptions): TestMemoryBackend {
  const clock = createControlledClock(options.start);
  const backend = backendOver(createMemoryStore({ clock }), options.profile, options.publication);
  return {
    submit: (input, sponsorship) => backend.submit(input, sponsorship),
    query: (q) => backend.query(q),
    get log() {
      return backend.log;
    },
    get assurance() {
      return backend.assurance;
    },
    migration: backend.migration,
    clock,
    randomBytes: seededRandomBytes(options.seed),
    // The rules run with their defaults here (`backendOver`), so these are those defaults.
    maxRecordingLag: DEFAULT_MAX_RECORDING_LAG,
    maxClockSkew: DEFAULT_MAX_CLOCK_SKEW,
    maxPassWindow: DEFAULT_MAX_PASS_WINDOW,
  };
}
