// @ticketto/binding-offchain/testing — test controls over a service in test mode,
// for tests and the conformance suite only (T-007-03; F-010 §5.5; C4.md
// Appendix A; REQ-SDK-7).
//
// The conformance suite's `TestControls` are synchronous: `clock.set(t)` returns
// before the next statement submits. Over the wire that is a request, so the
// backend made here keeps the time the service's clock will have, answers
// `now()` from it, and sends each change in order — and every request the port
// makes waits until the changes before it have landed. A test therefore sees
// exactly the clock it set. A change the service refuses fails the next request
// loudly, never silently.

import {
  type Backend,
  type Cursor,
  createSubmission,
  type Result,
  type Timestamp,
} from "@ticketto/sdk";
import {
  backendOver,
  type OffchainBackendOptions,
  offchainParts,
  readAssurance,
} from "../backend.js";
import type { FetchLike } from "../client.js";

/** A clock the test moves; the service's rules read it (`REQ-SDK-3`). Never backwards. */
export interface OffchainTestClock {
  now(): Timestamp;
  set(time: Timestamp): void;
  advance(ms: number): void;
}

/** The port over a service in test mode, with its clock, seeded randomness and gate parameters. */
export interface TestOffchainBackend extends Backend {
  readonly clock: OffchainTestClock;
  /**
   * How long after a pass's `notAfter` the service still records it, in
   * milliseconds, as its rules are configured (C4.md A.3; `F-008` §5.6).
   */
  readonly maxRecordingLag: number;
  /**
   * How far ahead of the service's clock a pass's `presentedAt` may lie, in
   * milliseconds, as its rules are configured (C4.md A.3; `F-008` §5.2).
   */
  readonly maxClockSkew: number;
  /**
   * The longest window, `notAfter − notBefore`, a pass may carry, in
   * milliseconds, as the service's rules are configured (C4.md A.3; `F-008` §5.2).
   */
  readonly maxPassWindow: number;
  /**
   * Random bytes from a seeded source, for operation and pass ids. Backends made
   * with the same seed yield the same sequence. Not cryptographically secure.
   */
  randomBytes(length: number): Uint8Array;
}

export interface TestOffchainBackendOptions extends OffchainBackendOptions {
  /** Seeds `randomBytes`. Defaults to 0. */
  readonly seed?: number;
}

/** The service refused a clock change, or is not in test mode. */
export class TestModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestModeError";
  }
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

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

function platformFetch(): FetchLike {
  const fetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (fetch === undefined) throw new Error("this platform has no fetch; pass one in the options");
  return (url, init) => fetch(url, init);
}

/** `{ now }` from a test-mode clock response (C4.md A.1, A.2). */
async function clockAnswer(
  fetch: FetchLike,
  url: string,
  body?: { set: Timestamp } | { advance: number },
): Promise<Timestamp> {
  const response = await fetch(`${url}/v0/testing/clock`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": JSON_CONTENT_TYPE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (response.status === 404) {
    throw new TestModeError("the service is not in test mode: /v0/testing/clock does not exist");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const now = (parsed as { now?: unknown } | undefined)?.now;
  if (response.status !== 200 || typeof now !== "number" || !Number.isSafeInteger(now)) {
    throw new TestModeError(`the service refused a clock change: ${response.status} ${text}`);
  }
  return now;
}

/** The limits the service's rules run with (C4.md A.3), in milliseconds. */
interface RulesLimits {
  readonly maxRecordingLag: number;
  readonly maxClockSkew: number;
  readonly maxPassWindow: number;
  readonly maxOperationLifetime: number;
}

/** `GET /v0/testing/config` (C4.md A.3). */
async function rulesLimits(fetch: FetchLike, url: string): Promise<RulesLimits> {
  const response = await fetch(`${url}/v0/testing/config`, { method: "GET", headers: {} });
  const text = await response.text();
  if (response.status === 404) {
    throw new TestModeError("the service is not in test mode: /v0/testing/config does not exist");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  const limit = (name: keyof RulesLimits): number => {
    const value = body[name];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new TestModeError(
        `the service's test-mode config has no ${name}: ${response.status} ${text}`,
      );
    }
    return value;
  };
  if (response.status !== 200) {
    throw new TestModeError(
      `the service did not answer its test-mode config: ${response.status} ${text}`,
    );
  }
  return {
    maxRecordingLag: limit("maxRecordingLag"),
    maxClockSkew: limit("maxClockSkew"),
    maxPassWindow: limit("maxPassWindow"),
    maxOperationLifetime: limit("maxOperationLifetime"),
  };
}

/**
 * Connects to a service in test mode (`TICKETTO_TEST_MODE=1`): the port, with
 * the service's settable clock, seeded randomness, and the gate parameters its
 * rules are configured with (C4.md A.3). `ERR-LedgerUnavailable`
 * when the service cannot be reached; `TestModeError` when it is not in test mode.
 */
export async function connectTestOffchainBackend(
  options: TestOffchainBackendOptions,
): Promise<Result<TestOffchainBackend>> {
  const parts = offchainParts(options);
  const assurance = await readAssurance(parts);
  if (!assurance.ok) return assurance;

  const url = options.url.replace(/\/+$/, "");
  const fetch = options.fetch ?? platformFetch();
  let current = await clockAnswer(fetch, url);
  const limits = await rulesLimits(fetch, url);
  // Every clock change, chained in order; a refused one stays rejected.
  let landed: Promise<void> = Promise.resolve();
  landed.catch(() => {});

  const change = (body: { set: Timestamp } | { advance: number }, expected: Timestamp) => {
    landed = landed.then(async () => {
      const now = await clockAnswer(fetch, url, body);
      if (now !== expected) {
        throw new TestModeError(`the service's clock is at ${now}, not ${expected}`);
      }
    });
    landed.catch(() => {});
  };

  const clock: OffchainTestClock = {
    now: () => current,
    set(time) {
      if (!Number.isSafeInteger(time) || time < 0) {
        throw new RangeError(`a timestamp is a non-negative safe integer, not ${time}`);
      }
      if (time < current) throw new RangeError(`the clock is monotonic: ${time} < ${current}`);
      current = time;
      change({ set: time }, time);
    },
    advance(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) {
        throw new RangeError(`the clock advances by a non-negative safe integer, not ${ms}`);
      }
      current += ms;
      change({ advance: ms }, current);
    },
  };

  const inner = backendOver(options, parts, assurance.value);

  const submit: Backend["submit"] = (input, sponsorship) => {
    const controller = createSubmission();
    (async () => {
      await landed;
      const iterator = inner.submit(input, sponsorship)[Symbol.asyncIterator]();
      let submitted = false;
      for (;;) {
        const next = await iterator.next();
        if (next.done === true) return;
        const state = next.value;
        switch (state.state) {
          case "submitted":
            if (!submitted) controller.submitted(state.operationId);
            submitted = true;
            break;
          case "settled":
            controller.settled(state.receipt);
            return;
          case "rejected":
            controller.rejected(state.error);
            return;
          default:
            throw new Error("an unknown submission state");
        }
      }
    })().catch((reason: unknown) => controller.failed(reason));
    return controller.submission;
  };

  const backend: TestOffchainBackend = {
    submit,
    query: async (query) => {
      await landed;
      return inner.query(query);
    },
    log: {
      read: async (from: Cursor, limit: number) => {
        await landed;
        return inner.log.read(from, limit);
      },
      hints: () => ({
        [Symbol.asyncIterator]() {
          const iterator = inner.log.hints()[Symbol.asyncIterator]();
          return {
            next: async () => {
              await landed;
              return iterator.next();
            },
            return: async () => iterator.return?.() ?? { done: true, value: undefined },
          };
        },
      }),
    },
    assurance: inner.assurance,
    clock,
    randomBytes: seededRandomBytes(options.seed),
    maxRecordingLag: limits.maxRecordingLag,
    maxClockSkew: limits.maxClockSkew,
    maxPassWindow: limits.maxPassWindow,
  };
  return { ok: true, value: backend };
}
