/// <reference types="node" />
// T-008-11: the same pass consumed by two concurrent transactions — exactly one
// succeeds (features/008-ledger-rules/plan.md §5.1, §7; SPEC.md AC-E3.2, INV-6).
//
// Each run gives the rules capabilities whose every registry call yields a
// random number of turns, starts the two submissions a random distance apart,
// and picks a random policy and two distinct presentation times — two gates
// scanning one QR code. The fake capabilities serialise transactions; the same
// scenario over capabilities that do not is shown to double-consume, so the test
// can fail.

import { producePass } from "@ticketto/profile-v0";
import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Discriminator,
  EventId,
  Receipt,
  Result,
  SignedAccessPass,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../test/fake-capabilities.js";
import { id32, profile, registered } from "../test/fixtures.js";
import type { Capabilities, Registry } from "./capabilities.js";
import { execute } from "./execute.js";

const RUNS = 1_000;
const T0 = 1_000_000;
const WINDOW = 60_000;

/** mulberry32: a small seeded generator, so a failing run can be reproduced from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Yields between zero and three turns, microtask or macrotask, at random. */
async function jitter(next: () => number): Promise<void> {
  const turns = Math.floor(next() * 4);
  for (let i = 0; i < turns; i++) {
    if (next() < 0.5) await turn();
    else await Promise.resolve();
  }
}

/** The registry, with random yields before every call. */
function jittered(registry: Registry, next: () => number): Registry {
  const wrapped: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(registry)) {
    wrapped[name] = async (...args: unknown[]) => {
      await jitter(next);
      return (method as (...a: unknown[]) => Promise<unknown>)(...args);
    };
  }
  return wrapped as unknown as Registry;
}

/** Capabilities whose transactions see a jittered registry. */
function withJitter(caps: FakeCapabilities, next: () => number): Capabilities {
  return {
    registry: caps.registry,
    clock: caps.clock,
    transaction: (fn) => caps.transaction((tx) => fn(jittered(tx, next))),
  };
}

/** Capabilities that do not isolate transactions: each registry call commits on its own. */
function withoutIsolation(caps: FakeCapabilities, next: () => number): Capabilities {
  return {
    registry: caps.registry,
    clock: caps.clock,
    transaction: (fn) => fn(jittered(caps.registry, next)),
  };
}

const POLICIES: readonly AttendancePolicy[] = [
  { kind: "Single" },
  { kind: "Multiple", max: 5, until: null },
  { kind: "Unlimited", until: null },
  { kind: "Unlimited", until: T0 + WINDOW },
];

interface Scenario {
  readonly caps: FakeCapabilities;
  readonly ticket: TicketId;
  readonly signed: SignedAccessPass;
  readonly presentedAt: readonly [number, number];
  readonly gap: number;
}

async function scenario(next: () => number, identical = false): Promise<Scenario> {
  const caps = createFakeCapabilities();
  caps.clock.set(T0 + Math.floor(next() * 1_000));
  const holder = await registered(caps);
  const event = id32<EventId>();
  const zone = id32<ZoneId>();
  await caps.registry.putEvent({
    id: event,
    owner: id32<AccountId>(),
    status: next() < 0.5 ? "Active" : "Sealed",
    maxCapacity: null,
    issued: 1,
    zones: [{ id: zone, kind: "Unseated" }],
    zonesInUse: [zone],
  });
  const ticket = id32<TicketId>();
  await caps.registry.insertTicket({
    id: ticket,
    event,
    holder: holder.account,
    class: "01" as ClassId,
    provenance: "Purchased",
    zone,
    placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
    policy: POLICIES[Math.floor(next() * POLICIES.length)] ?? { kind: "Single" },
    restrictions: { cannotResale: false, cannotTransfer: false },
    attendances: 0,
  });
  const signed = await producePass(
    { ticket, holder: holder.account, notBefore: T0, window: WINDOW },
    holder.signer,
  );
  const first = T0 + Math.floor(next() * 1_000);
  const second = identical ? first : first + 1 + Math.floor(next() * 1_000);
  return {
    caps,
    ticket,
    signed,
    presentedAt: next() < 0.5 ? [first, second] : [second, first],
    gap: Math.floor(next() * 3),
  };
}

async function race(
  s: Scenario,
  caps: Capabilities,
  next: () => number,
): Promise<[Result<Receipt>, Result<Receipt>]> {
  const a = execute(caps, profile, s.signed, { presentedAt: s.presentedAt[0] });
  for (let i = 0; i < s.gap; i++) await jitter(next);
  const b = execute(caps, profile, s.signed, { presentedAt: s.presentedAt[1] });
  return Promise.all([a, b]);
}

describe("AC-E3.2: the same pass consumed by two transactions", () => {
  it(`AC-E3.2 / INV-6: exactly one succeeds over ${RUNS} randomised runs`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const seed = 0x5eed + run;
      const next = random(seed);
      const s = await scenario(next);
      const outcomes = await race(s, withJitter(s.caps, next), next);

      const accepted = outcomes.filter((o) => o.ok);
      const refusals = outcomes.flatMap((o) => (o.ok ? [] : [o.error.code]));
      const context = `run ${run}, seed ${seed}`;
      expect(accepted, context).toHaveLength(1);
      expect(refusals, context).toEqual(["ERR-PassReplayed"]);
      expect((await s.caps.registry.getTicket(s.ticket))?.attendances, context).toBe(1);
      expect(s.caps.log(), context).toHaveLength(1);
    }
  }, 120_000);

  it("INV-6: an identical resubmission racing its original records one attendance, both answered with its receipt", async () => {
    for (let run = 0; run < 200; run++) {
      const seed = 0xab5e + run;
      const next = random(seed);
      const s = await scenario(next, true);
      const [a, b] = await race(s, withJitter(s.caps, next), next);

      const context = `run ${run}, seed ${seed}`;
      expect(a.ok && b.ok, context).toBe(true);
      expect(b, context).toEqual(a);
      expect((await s.caps.registry.getTicket(s.ticket))?.attendances, context).toBe(1);
      expect(s.caps.log(), context).toHaveLength(1);
    }
  }, 60_000);

  it("the same race over capabilities that do not isolate transactions double-consumes, so the test can fail", async () => {
    let doubled = 0;
    for (let run = 0; run < 200; run++) {
      const next = random(0xbad + run);
      const s = await scenario(next);
      const outcomes = await race(s, withoutIsolation(s.caps, next), next);
      if (outcomes.every((o) => o.ok)) doubled += 1;
    }
    expect(doubled).toBeGreaterThan(0);
  }, 60_000);
});
