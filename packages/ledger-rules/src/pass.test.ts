// T-008-10: submitAccessPass, including retention (features/008-ledger-rules/
// plan.md §5.2, §5.6; SPEC.md US-E1, US-E3, REQ-AP-1–REQ-AP-4, INV-3, INV-5, INV-6).

import { producePass } from "@ticketto/profile-v0";
import type {
  AccountId,
  AttendancePolicy,
  Authorisation,
  ClassId,
  Discriminator,
  EventId,
  EventStatus,
  OperationId,
  PassId,
  Receipt,
  Result,
  SignedAccessPass,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../test/fake-capabilities.js";
import {
  createEventCommand,
  credential,
  id32,
  profile,
  registered,
  sign,
  type TestCredential,
} from "../test/fixtures.js";
import {
  DEFAULT_MAX_CLOCK_SKEW,
  DEFAULT_MAX_PASS_WINDOW,
  DEFAULT_MAX_RECORDING_LAG,
} from "./config.js";
import { configureExecute, type Execute, execute } from "./execute.js";
import { passDigest } from "./pass.js";

const T0 = 1_000_000;
const WINDOW = 60_000;

interface Gate {
  readonly caps: FakeCapabilities;
  readonly holder: TestCredential;
  readonly event: EventId;
  readonly ticket: TicketId;
  /** A fresh pass for the ticket, signed by `signer` (the holder by default), valid from `notBefore`. */
  pass(options?: {
    readonly notBefore?: number;
    readonly window?: number;
    readonly signer?: TestCredential;
    readonly id?: PassId;
  }): Promise<SignedAccessPass>;
  submit(signed: SignedAccessPass, presentedAt?: number, run?: Execute): Promise<Result<Receipt>>;
  attendances(): Promise<number | undefined>;
}

async function gate(
  options: { readonly policy?: AttendancePolicy; readonly status?: EventStatus } = {},
): Promise<Gate> {
  const caps = createFakeCapabilities();
  caps.clock.set(T0);
  const holder = await registered(caps);
  const event = id32<EventId>();
  const zone = id32<ZoneId>();
  await caps.registry.putEvent({
    id: event,
    owner: id32<AccountId>(),
    status: options.status ?? "Active",
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
    policy: options.policy ?? { kind: "Single" },
    restrictions: { cannotResale: false, cannotTransfer: false },
    attendances: 0,
  });
  return {
    caps,
    holder,
    event,
    ticket,
    pass: async (o = {}) => {
      const signer = o.signer ?? holder;
      return producePass(
        {
          ticket,
          holder: signer.account,
          notBefore: o.notBefore ?? T0,
          window: o.window ?? WINDOW,
          ...(o.id === undefined ? {} : { id: o.id }),
        },
        signer.signer,
      );
    },
    submit: (signed, presentedAt = T0, run = execute) =>
      run(caps, profile, signed, { presentedAt }),
    attendances: async () => (await caps.registry.getTicket(ticket))?.attendances,
  };
}

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

describe("submitAccessPass — acceptance (US-E3)", () => {
  it("AC-E3.1: a valid pass increments attendance by exactly one", async () => {
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    expect((await g.submit(await g.pass())).ok).toBe(true);
    expect(await g.attendances()).toBe(1);
    expect((await g.submit(await g.pass())).ok).toBe(true);
    expect(await g.attendances()).toBe(2);
  });

  it("REQ-AP-4: distinct passes for the same ticket are never refused as replays", async () => {
    const g = await gate({ policy: { kind: "Multiple", max: 3, until: null } });
    for (let i = 0; i < 3; i++) expect((await g.submit(await g.pass())).ok).toBe(true);
    expect(await g.attendances()).toBe(3);
  });

  it("records the pass, its presentation and its receipt; the pass id is the operation id", async () => {
    const g = await gate();
    const signed = await g.pass();
    g.caps.clock.set(T0 + 5_000);

    const result = (await g.submit(signed, T0 + 1_000)) as { ok: true; value: Receipt };
    expect(result.value.operationId).toBe(signed.pass.id);
    expect(g.caps.log()).toEqual([
      {
        cursor: result.value.cursor,
        recordedAt: T0 + 5_000,
        event: { id: g.event, sequence: 0 },
        entry: signed,
        presentedAt: T0 + 1_000,
      },
    ]);
    const retainUntil = signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG;
    expect(await g.caps.registry.getOperation(signed.pass.id as string as OperationId)).toEqual({
      expiresAt: retainUntil,
      digest: passDigest(signed, T0 + 1_000),
      receipt: result.value,
    });
    expect(await g.caps.registry.isPassConsumed(g.ticket, signed.pass.id)).toBe(true);
  });

  it("plan §5.6: keeps a consumed pass id until notAfter plus the maximum recording lag", async () => {
    const g = await gate();
    const retained: number[] = [];
    const caps = {
      ...g.caps,
      transaction: <T>(fn: (tx: never) => Promise<T>) =>
        g.caps.transaction((tx) =>
          fn({
            ...tx,
            recordConsumedPass: async (ticket: TicketId, pass: PassId, until: number) => {
              retained.push(until);
              return tx.recordConsumedPass(ticket, pass, until);
            },
          } as never),
        ),
    };
    const signed = await g.pass();
    expect((await execute(caps, profile, signed, { presentedAt: T0 })).ok).toBe(true);
    expect(retained).toEqual([signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG]);
  });
});

describe("submitAccessPass — the holder (REQ-AP-1)", () => {
  it("AC-E1.2: a pass signed by a non-holder fails with ERR-InvalidPass", async () => {
    const g = await gate();
    const stranger = await registered(g.caps);
    expect(codeOf(await g.submit(await g.pass({ signer: stranger })))).toBe("ERR-InvalidPass");
    expect(await g.attendances()).toBe(0);
  });

  it("AC-E1.2: a pass naming the holder but signed by another key fails with ERR-InvalidPass", async () => {
    const g = await gate();
    const stranger = await registered(g.caps);
    const genuine = await g.pass();
    const forged = await stranger.signer.sign(profile.encodePass(genuine.pass));
    expect(codeOf(await g.submit({ pass: genuine.pass, authorisation: forged }))).toBe(
      "ERR-InvalidPass",
    );
  });

  it("ERR-InvalidPass: a pass by the holder at production, after the ticket changed hands", async () => {
    const g = await gate();
    const signed = await g.pass();
    await g.caps.registry.setHolder(g.ticket, id32<AccountId>());
    expect(codeOf(await g.submit(signed))).toBe("ERR-InvalidPass");
  });

  it("ERR-InvalidPass: a pass whose credential is not registered", async () => {
    const g = await gate();
    const unregistered = credential();
    await g.caps.registry.setHolder(g.ticket, unregistered.account);
    expect(codeOf(await g.submit(await g.pass({ signer: unregistered })))).toBe("ERR-InvalidPass");
  });

  it("ERR-InvalidPass: a malformed authorisation", async () => {
    const g = await gate();
    const signed = await g.pass();
    const malformed = { ...signed, authorisation: new Uint8Array([1]) as Authorisation };
    expect(codeOf(await g.submit(malformed))).toBe("ERR-InvalidPass");
  });

  it("ERR-InvalidPass: a pass altered after signing", async () => {
    const g = await gate();
    const signed = await g.pass();
    const altered = { ...signed, pass: { ...signed.pass, notAfter: signed.pass.notAfter + 1 } };
    expect(codeOf(await g.submit(altered))).toBe("ERR-InvalidPass");
  });

  it("ERR-TicketNotFound: a pass for a ticket that does not exist", async () => {
    const g = await gate();
    const signed = await g.pass();
    const elsewhere = { ...signed, pass: { ...signed.pass, ticket: id32<TicketId>() } };
    expect(codeOf(await g.submit(elsewhere))).toBe("ERR-TicketNotFound");
  });
});

describe("submitAccessPass — the window (REQ-AP-3)", () => {
  it("AC-E1.3: a pass presented after its window has closed fails with ERR-PassExpired", async () => {
    const g = await gate();
    const signed = await g.pass();
    g.caps.clock.set(signed.pass.notAfter + 1);
    expect(codeOf(await g.submit(signed, signed.pass.notAfter + 1))).toBe("ERR-PassExpired");
    expect(await g.attendances()).toBe(0);
  });

  it("ERR-PassExpired: presented before its window opens", async () => {
    const g = await gate();
    const signed = await g.pass({ notBefore: T0 + 1_000 });
    expect(codeOf(await g.submit(signed, T0 + 999))).toBe("ERR-PassExpired");
  });

  it("accepts presentation at either edge of the window", async () => {
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    const first = await g.pass();
    expect((await g.submit(first, first.pass.notBefore)).ok).toBe(true);
    const second = await g.pass();
    g.caps.clock.set(second.pass.notAfter);
    expect((await g.submit(second, second.pass.notAfter)).ok).toBe(true);
  });

  it("records a pass presented within its window, up to notAfter plus the maximum recording lag", async () => {
    const g = await gate();
    const signed = await g.pass();
    g.caps.clock.set(signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG);
    expect((await g.submit(signed, signed.pass.notAfter)).ok).toBe(true);
  });

  it("ERR-PassExpired: recorded later than notAfter plus the maximum recording lag", async () => {
    const g = await gate();
    const signed = await g.pass();
    g.caps.clock.set(signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG + 1);
    expect(codeOf(await g.submit(signed, signed.pass.notAfter))).toBe("ERR-PassExpired");
  });

  it("ERR-PassExpired: a presentedAt further ahead of the clock than the maximum skew", async () => {
    const g = await gate();
    const signed = await g.pass({ notBefore: T0 });
    expect(codeOf(await g.submit(signed, T0 + DEFAULT_MAX_CLOCK_SKEW + 1))).toBe("ERR-PassExpired");
    expect((await g.submit(signed, T0 + DEFAULT_MAX_CLOCK_SKEW)).ok).toBe(true);
  });

  it("the recording lag and clock skew are rules configuration", async () => {
    const run = configureExecute({ maxRecordingLag: 1_000, maxClockSkew: 0 });
    const g = await gate({ policy: { kind: "Unlimited", until: null } });

    const late = await g.pass();
    g.caps.clock.set(late.pass.notAfter + 1_001);
    expect(codeOf(await g.submit(late, late.pass.notAfter, run))).toBe("ERR-PassExpired");

    const ahead = await g.pass({ notBefore: late.pass.notAfter + 1_001 });
    expect(codeOf(await g.submit(ahead, late.pass.notAfter + 1_002, run))).toBe("ERR-PassExpired");
    expect((await g.submit(ahead, late.pass.notAfter + 1_001, run)).ok).toBe(true);
    expect(() => configureExecute({ maxRecordingLag: -1 })).toThrow(RangeError);
    expect(() => configureExecute({ maxClockSkew: 0.5 })).toThrow(RangeError);
  });
});

describe("submitAccessPass — maximum pass window (REQ-AP-3)", () => {
  it("ERR-PassExpired: a pass whose window is longer than the default maximum", async () => {
    const g = await gate();
    const signed = await g.pass({ window: DEFAULT_MAX_PASS_WINDOW + 1 });
    expect(codeOf(await g.submit(signed))).toBe("ERR-PassExpired");
    expect(await g.attendances()).toBe(0);
    expect(await g.caps.registry.isPassConsumed(g.ticket, signed.pass.id)).toBe(false);
  });

  it("accepts a pass whose window is exactly the default maximum", async () => {
    const g = await gate();
    expect(DEFAULT_MAX_PASS_WINDOW).toBe(5 * 60 * 1000);
    expect((await g.submit(await g.pass({ window: DEFAULT_MAX_PASS_WINDOW }))).ok).toBe(true);
  });

  it("the maximum pass window is rules configuration", async () => {
    const run = configureExecute({ maxPassWindow: 1_000 });
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    expect(codeOf(await g.submit(await g.pass({ window: 1_001 }), T0, run))).toBe(
      "ERR-PassExpired",
    );
    expect((await g.submit(await g.pass({ window: 1_000 }), T0, run)).ok).toBe(true);
    expect(() => configureExecute({ maxPassWindow: -1 })).toThrow(RangeError);
  });

  it("the window's length is checked after the holder", async () => {
    const g = await gate();
    const stranger = await registered(g.caps);
    const signed = await g.pass({ signer: stranger, window: DEFAULT_MAX_PASS_WINDOW + 1 });
    expect(codeOf(await g.submit(signed))).toBe("ERR-InvalidPass");
  });
});

describe("submitAccessPass — single use (INV-6)", () => {
  it("AC-E1.4: a consumed pass submitted again by another gate fails with ERR-PassReplayed", async () => {
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    const signed = await g.pass();
    expect((await g.submit(signed, T0)).ok).toBe(true);

    // The same QR code scanned at a second gate, a moment later (AC-E3.4, REQ-OP-3).
    expect(codeOf(await g.submit(signed, T0 + 1))).toBe("ERR-PassReplayed");
    expect(await g.attendances()).toBe(1);
  });

  it("REQ-CM-1: an identical resubmission returns the original receipt, changing nothing", async () => {
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    const signed = await g.pass();
    const first = await g.submit(signed, T0);
    g.caps.clock.set(signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG);
    expect(await g.submit(signed, T0)).toEqual(first);
    expect(await g.attendances()).toBe(1);
    expect(g.caps.log()).toHaveLength(1);
  });

  it("an identical resubmission after notAfter plus the lag is ERR-PassExpired, never replayed", async () => {
    const g = await gate();
    const signed = await g.pass();
    await g.submit(signed, T0);
    g.caps.clock.set(signed.pass.notAfter + DEFAULT_MAX_RECORDING_LAG + 1);
    expect(codeOf(await g.submit(signed, T0))).toBe("ERR-PassExpired");
  });

  it("ERR-OperationConflict: a pass whose id is a command's operation id", async () => {
    const g = await gate();
    const create = createEventCommand(g.holder.account, { expiresAt: T0 + 60_000 });
    const commandResult = await execute(g.caps, profile, await sign(g.holder, create));
    expect(commandResult.ok).toBe(true);

    const signed = await g.pass({ id: create.operationId as string as PassId });
    expect(codeOf(await g.submit(signed))).toBe("ERR-OperationConflict");
    expect(await g.attendances()).toBe(0);
    expect((await g.caps.registry.getOperation(create.operationId))?.receipt).toEqual(
      (commandResult as { ok: true; value: Receipt }).value,
    );
  });

  it("the same pass id is consumed per ticket", async () => {
    const g = await gate();
    const signed = await g.pass();
    expect(await g.caps.registry.isPassConsumed(g.ticket, signed.pass.id)).toBe(false);
    await g.submit(signed);
    expect(await g.caps.registry.isPassConsumed(g.ticket, signed.pass.id)).toBe(true);
    expect(await g.caps.registry.isPassConsumed(id32<TicketId>(), signed.pass.id)).toBe(false);
  });
});

describe("submitAccessPass — attendance policy (US-B1)", () => {
  it("AC-B1.1: a Single ticket admits exactly once", async () => {
    const g = await gate({ policy: { kind: "Single" } });
    expect((await g.submit(await g.pass())).ok).toBe(true);
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-CannotAttend");
    expect(await g.attendances()).toBe(1);
  });

  it("AC-B1.2: a Multiple { max: n } ticket admits at most n times", async () => {
    const g = await gate({ policy: { kind: "Multiple", max: 3, until: null } });
    for (let i = 0; i < 3; i++) expect((await g.submit(await g.pass())).ok).toBe(true);
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-CannotAttend");
    expect(await g.attendances()).toBe(3);
  });

  it("AC-B1.3: an Unlimited { until: t } ticket admits any number of times at or before t", async () => {
    const until = T0 + 30_000;
    const g = await gate({ policy: { kind: "Unlimited", until } });
    for (let i = 0; i < 25; i++) expect((await g.submit(await g.pass(), T0 + i)).ok).toBe(true);
    const atUntil = await g.pass({ notBefore: until });
    g.caps.clock.set(until);
    expect((await g.submit(atUntil, until)).ok).toBe(true);
    expect(await g.attendances()).toBe(26);
  });

  it("AC-B1.4: entry after a policy's until fails with ERR-TicketExpired", async () => {
    const until = T0 + 30_000;
    for (const policy of [
      { kind: "Unlimited", until },
      { kind: "Multiple", max: 5, until },
    ] as const) {
      const g = await gate({ policy });
      const signed = await g.pass({ notBefore: until + 1 });
      g.caps.clock.set(until + 1);
      expect(codeOf(await g.submit(signed, until + 1))).toBe("ERR-TicketExpired");
      expect(await g.attendances()).toBe(0);
    }
  });

  it("§7.E: policy expiry is judged at presentation, not at recording", async () => {
    const until = T0 + 30_000;
    const g = await gate({ policy: { kind: "Unlimited", until } });
    const signed = await g.pass({ notBefore: until - 10_000 });
    g.caps.clock.set(until + 60_000);
    expect((await g.submit(signed, until)).ok).toBe(true);
  });

  it("AC-E3.3: an exhausted allowance fails with ERR-CannotAttend, attendance unchanged", async () => {
    const g = await gate({ policy: { kind: "Multiple", max: 1, until: null } });
    await g.submit(await g.pass());
    const log = g.caps.log().length;
    const signed = await g.pass();
    expect(codeOf(await g.submit(signed))).toBe("ERR-CannotAttend");
    expect(await g.attendances()).toBe(1);
    expect(g.caps.log()).toHaveLength(log);
    expect(await g.caps.registry.isPassConsumed(g.ticket, signed.pass.id)).toBe(false);
  });

  it("AC-A5.2: attendance against a Cancelled event fails with ERR-EventCancelled", async () => {
    const g = await gate({ status: "Cancelled" });
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-EventCancelled");
  });

  it("INV-16: attendance against a Finished event fails with ERR-EventFinished", async () => {
    const g = await gate({ status: "Finished" });
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-EventFinished");
    expect(await g.attendances()).toBe(0);
  });

  it("AC-A4.2: a Sealed event's ticket still admits", async () => {
    const g = await gate({ status: "Sealed" });
    expect((await g.submit(await g.pass())).ok).toBe(true);
  });
});

describe("submitAccessPass — check order (plan §5.2)", () => {
  it("the holder before the window", async () => {
    const g = await gate();
    const stranger = await registered(g.caps);
    const signed = await g.pass({ signer: stranger });
    expect(codeOf(await g.submit(signed, T0 - 1))).toBe("ERR-InvalidPass");
  });

  it("the window before single use", async () => {
    const g = await gate({ policy: { kind: "Unlimited", until: null } });
    const signed = await g.pass();
    await g.submit(signed, T0);
    expect(codeOf(await g.submit(signed, T0 - 1))).toBe("ERR-PassExpired");
  });

  it("single use before the event's status and the policy", async () => {
    const g = await gate({ policy: { kind: "Single" } });
    const signed = await g.pass();
    await g.submit(signed, T0);
    const event = await g.caps.registry.getEvent(g.event);
    if (event === null) throw new Error("fixture");
    await g.caps.registry.putEvent({ ...event, status: "Cancelled" });
    expect(codeOf(await g.submit(signed, T0 + 1))).toBe("ERR-PassReplayed");
  });

  it("the event's status before policy expiry and allowance", async () => {
    const g = await gate({
      status: "Cancelled",
      policy: { kind: "Multiple", max: 0, until: T0 - 1 },
    });
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-EventCancelled");
  });

  it("policy expiry before allowance", async () => {
    const g = await gate({ policy: { kind: "Multiple", max: 0, until: T0 - 1 } });
    expect(codeOf(await g.submit(await g.pass()))).toBe("ERR-TicketExpired");
  });
});

describe("submitAccessPass — defects", () => {
  it("throws for a pass submitted without presentedAt", async () => {
    const g = await gate();
    await expect(execute(g.caps, profile, await g.pass())).rejects.toThrow(TypeError);
  });
});
