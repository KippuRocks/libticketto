// T-008-02: the execute skeleton — envelope, replay, authorisation, INV-16 and
// log emission (features/008-ledger-rules/plan.md §5.2, §5.4).

import { decodeSignedCommand, encodeSignedCommand } from "@ticketto/profile-v0";
import type {
  AccountId,
  Authorisation,
  Event,
  EventId,
  Receipt,
  Result,
  TicketId,
} from "@ticketto/sdk";
import { describe, expect, it, vi } from "vitest";
import { commandOf, EVENT_COMMAND_KINDS, ticketIn } from "../test/commands.js";
import { createFakeCapabilities, type FakeCapabilities } from "../test/fake-capabilities.js";
import {
  createEventCommand,
  credential,
  eventId,
  profile,
  registered,
  sign,
} from "../test/fixtures.js";
import type { EventRecord } from "./capabilities.js";
import {
  configureExecute,
  createExecute,
  DEFAULT_MAX_OPERATION_LIFETIME,
  execute,
  handlers as v0Handlers,
} from "./execute.js";
import { accept, type CommandHandler, type CommandHandlers, reject } from "./handler.js";

/** Handlers that accept every command by recording its event as Active. */
function acceptingHandlers(spy: () => void = () => {}): CommandHandlers {
  const handler: CommandHandler<never> = async ({ tx, command, signer }) => {
    spy();
    return accept(async () => {
      const id = (command as { event?: EventId }).event;
      if (id !== undefined) {
        await tx.putEvent({
          id,
          owner: signer,
          status: "Active",
          maxCapacity: null,
          issued: 0,
          zones: [],
          zonesInUse: [],
        });
      }
    });
  };
  return Object.fromEntries(Object.keys(v0Handlers).map((kind) => [kind, handler])) as never;
}

function event(id: EventId, owner: AccountId, status: Event["status"]): EventRecord {
  return { id, owner, status, maxCapacity: null, issued: 0, zones: [], zonesInUse: [] };
}

function expectError(result: Result<unknown>, code: string) {
  expect(result.ok ? "accepted" : result.error.code).toBe(code);
}

async function setup(): Promise<{ caps: FakeCapabilities }> {
  return { caps: createFakeCapabilities() };
}

describe("execute — replay (REQ-CM-1, plan §5.4)", () => {
  it("REQ-CM-1: an identical replay returns the original receipt, and changes nothing", async () => {
    const { caps } = await setup();
    const spy = vi.fn();
    const run = createExecute(acceptingHandlers(spy));
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));

    const first = await run(caps, profile, signed);
    const replay = await run(caps, profile, signed);

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(caps.log()).toHaveLength(1);
  });

  it("REQ-CM-1: a replay decoded afresh — equal bytes, not the same object — is still identical", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));

    const first = await run(caps, profile, signed);
    const decoded = decodeSignedCommand(encodeSignedCommand(signed));
    if (!decoded.ok) throw new Error("a signed command round-trips");
    expect(decoded.value).not.toBe(signed);
    expect(await run(caps, profile, decoded.value)).toEqual(first);
  });

  it("ERR-OperationConflict: the same operation id with a different command is rejected", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const original = await sign(organiser, commandOf("createEvent", eventId()));
    await run(caps, profile, original);

    const different = await sign(organiser, {
      ...commandOf("createEvent", eventId()),
      operationId: original.command.operationId,
    });
    expectError(await run(caps, profile, different), "ERR-OperationConflict");
    expect(caps.log()).toHaveLength(1);
  });

  it("ERR-OperationConflict: a different authorisation over the same command is a different input", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const original = await sign(organiser, commandOf("createEvent", eventId()));
    await run(caps, profile, original);

    const tampered = new Uint8Array(original.authorisation);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    const reauthorised = { ...original, authorisation: tampered as Authorisation };
    expectError(await run(caps, profile, reauthorised), "ERR-OperationConflict");
  });

  it("a rejected command records no operation, so the same id may be submitted again", async () => {
    const { caps } = await setup();
    let refuse = true;
    const handler: CommandHandler<never> = async () =>
      refuse ? reject({ code: "ERR-NotOwner" }) : accept(async () => {});
    const run = createExecute(
      Object.fromEntries(Object.keys(v0Handlers).map((k) => [k, handler])) as never,
    );
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));

    expectError(await run(caps, profile, signed), "ERR-NotOwner");
    expect(caps.log()).toHaveLength(0);
    refuse = false;
    expect((await run(caps, profile, signed)).ok).toBe(true);
  });
});

describe("execute — the envelope", () => {
  it("ERR-OperationExpired: a command after its expiry is rejected", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId(), { expiresAt: 100 }));

    caps.clock.set(101);
    expectError(await run(caps, profile, signed), "ERR-OperationExpired");
    expect(caps.log()).toHaveLength(0);
  });

  it("a command at exactly its expiry is still accepted", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId(), { expiresAt: 100 }));

    caps.clock.set(100);
    expect((await run(caps, profile, signed)).ok).toBe(true);
  });

  it("ERR-OperationExpired: an identical replay after expiry is rejected by the envelope (plan §5.4)", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId(), { expiresAt: 100 }));
    expect((await run(caps, profile, signed)).ok).toBe(true);

    caps.clock.set(101);
    expectError(await run(caps, profile, signed), "ERR-OperationExpired");
  });

  it("an operation record past its own expiry is treated as forgotten", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const original = await sign(organiser, commandOf("createEvent", eventId(), { expiresAt: 100 }));
    await run(caps, profile, original);

    caps.clock.set(101);
    const later = await sign(organiser, {
      ...commandOf("createEvent", eventId(), { expiresAt: 1_000 }),
      operationId: original.command.operationId,
    });
    expect((await run(caps, profile, later)).ok).toBe(true);
  });
});

describe("execute — maximum operation lifetime (plan §5.4)", () => {
  const HOUR = 60 * 60 * 1000;

  it("ERR-OperationExpired: an expiry beyond the default 24-hour maximum is rejected", async () => {
    const { caps } = await setup();
    const organiser = await registered(caps);
    caps.clock.set(1_000);
    const signed = await sign(
      organiser,
      createEventCommand(organiser.account, { expiresAt: 1_000 + 24 * HOUR + 1 }),
    );
    expectError(await execute(caps, profile, signed), "ERR-OperationExpired");
    expect(caps.log()).toHaveLength(0);
    expect(await caps.registry.getOperation(signed.command.operationId)).toBeNull();
  });

  it("an expiry exactly at the default maximum is accepted", async () => {
    const { caps } = await setup();
    const organiser = await registered(caps);
    caps.clock.set(1_000);
    const signed = await sign(
      organiser,
      createEventCommand(organiser.account, { expiresAt: 1_000 + 24 * HOUR }),
    );
    expect((await execute(caps, profile, signed)).ok).toBe(true);
    expect(DEFAULT_MAX_OPERATION_LIFETIME).toBe(24 * HOUR);
  });

  it("ERR-OperationExpired: the configured maximum applies, and one exactly at it is accepted", async () => {
    const { caps } = await setup();
    const run = configureExecute({ maxOperationLifetime: 5_000 });
    const organiser = await registered(caps);
    caps.clock.set(10_000);

    const beyond = await sign(
      organiser,
      createEventCommand(organiser.account, { expiresAt: 15_001, salt: new Uint8Array([1]) }),
    );
    expectError(await run(caps, profile, beyond), "ERR-OperationExpired");

    const at = await sign(
      organiser,
      createEventCommand(organiser.account, { expiresAt: 15_000, salt: new Uint8Array([2]) }),
    );
    expect((await run(caps, profile, at)).ok).toBe(true);
  });

  it("the maximum is measured from the authority's clock when the command is executed", async () => {
    const { caps } = await setup();
    const run = configureExecute({ maxOperationLifetime: 5_000 });
    const organiser = await registered(caps);
    const signed = await sign(
      organiser,
      createEventCommand(organiser.account, { expiresAt: 8_000 }),
    );

    expectError(await run(caps, profile, signed), "ERR-OperationExpired");
    caps.clock.set(3_000);
    expect((await run(caps, profile, signed)).ok).toBe(true);
  });

  it("refuses a maximum that is not a non-negative whole number of milliseconds", () => {
    expect(() => configureExecute({ maxOperationLifetime: -1 })).toThrow(RangeError);
    expect(() => configureExecute({ maxOperationLifetime: 1.5 })).toThrow(RangeError);
  });
});

describe("execute — authorisation (REQ-CP-6)", () => {
  it("ERR-InvalidAuthorisation: a credential not registered to its account is rejected", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const stranger = credential();
    const signed = await sign(stranger, commandOf("createEvent", eventId()));
    expectError(await run(caps, profile, signed), "ERR-InvalidAuthorisation");
    expect(caps.log()).toHaveLength(0);
  });

  it("ERR-InvalidAuthorisation: an authorisation over a different command is rejected", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));
    const other = await sign(organiser, commandOf("createEvent", eventId()));
    const swapped = { command: signed.command, authorisation: other.authorisation };
    expectError(await run(caps, profile, swapped), "ERR-InvalidAuthorisation");
  });

  it("ERR-InvalidAuthorisation: a malformed authorisation is rejected", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const signed = {
      command: commandOf("createEvent", eventId()),
      authorisation: new Uint8Array([9, 9, 9]) as Authorisation,
    };
    expectError(await run(caps, profile, signed), "ERR-InvalidAuthorisation");
  });

  it("ERR-InvalidAuthorisation: another account's registration of a different key does not verify", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const signer = credential();
    const other = credential();
    // The signer's credential id, registered against the signer's account, but with another key.
    await caps.registry.addRegistration(signer.account, {
      credential: signer.credential,
      registration: other.registration,
    });
    const signed = await sign(signer, commandOf("createEvent", eventId()));
    expectError(await run(caps, profile, signed), "ERR-InvalidAuthorisation");
  });

  it("hands the handler the signing account", async () => {
    const { caps } = await setup();
    const seen: AccountId[] = [];
    const handler: CommandHandler<never> = async ({ signer }) => {
      seen.push(signer);
      return accept(async () => {});
    };
    const run = createExecute(
      Object.fromEntries(Object.keys(v0Handlers).map((k) => [k, handler])) as never,
    );
    const organiser = await registered(caps);
    await run(caps, profile, await sign(organiser, commandOf("createEvent", eventId())));
    expect(seen).toEqual([organiser.account]);
  });
});

describe("execute — INV-16", () => {
  it.each(EVENT_COMMAND_KINDS)(
    "INV-16: a Finished event rejects %s with ERR-EventFinished, changing nothing",
    async (kind) => {
      const { caps } = await setup();
      const organiser = await registered(caps);
      const id = eventId();
      await caps.registry.putEvent(event(id, organiser.account, "Finished"));
      const signed = await sign(organiser, commandOf(kind, id, { account: organiser.account }));
      const named = signed.command as { kind: string; ticket?: TicketId };
      if (named.kind === "transferTicket" || named.kind === "removeRestriction") {
        await caps.registry.insertTicket(ticketIn(id, named.ticket as TicketId, organiser.account));
      }

      expectError(await execute(caps, profile, signed), "ERR-EventFinished");
      expect(caps.log()).toHaveLength(0);
      expect(await caps.registry.getOperation(signed.command.operationId)).toBeNull();
      expect(await caps.registry.getEvent(id)).toEqual(event(id, organiser.account, "Finished"));
    },
  );

  it("the Finished check follows authorisation", async () => {
    const { caps } = await setup();
    const id = eventId();
    await caps.registry.putEvent(event(id, "00" as AccountId, "Finished"));
    const signed = await sign(credential(), commandOf("setEventStatus", id));
    expectError(await execute(caps, profile, signed), "ERR-InvalidAuthorisation");
  });
});

describe("execute — check order (plan §5.2)", () => {
  it("expiry precedes replay: an expired command reusing an operation id is ERR-OperationExpired", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const original = await sign(organiser, commandOf("createEvent", eventId()));
    await run(caps, profile, original);

    caps.clock.set(original.command.expiresAt - 1);
    const expired = await sign(organiser, {
      ...commandOf("createEvent", eventId(), { expiresAt: 10 }),
      operationId: original.command.operationId,
    });
    expectError(await run(caps, profile, expired), "ERR-OperationExpired");
  });

  it("replay precedes authorisation: a conflicting, unauthorised command is ERR-OperationConflict", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const original = await sign(organiser, commandOf("createEvent", eventId()));
    await run(caps, profile, original);

    const stranger = await sign(credential(), {
      ...commandOf("createEvent", eventId()),
      operationId: original.command.operationId,
    });
    expectError(await run(caps, profile, stranger), "ERR-OperationConflict");
  });

  it("INV-16 precedes the command's own checks", async () => {
    const { caps } = await setup();
    const handler: CommandHandler<never> = async () => reject({ code: "ERR-NotOwner" });
    const run = createExecute(
      Object.fromEntries(Object.keys(v0Handlers).map((k) => [k, handler])) as never,
    );
    const organiser = await registered(caps);
    const id = eventId();
    await caps.registry.putEvent(event(id, organiser.account, "Finished"));
    expectError(
      await run(caps, profile, await sign(organiser, commandOf("setEventStatus", id))),
      "ERR-EventFinished",
    );
  });
});

describe("execute — log emission (REQ-SDK-5)", () => {
  it("REQ-SDK-5: an accepted command appends one record carrying the signed input", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const id = eventId();
    caps.clock.set(42);
    const signed = await sign(organiser, commandOf("createEvent", id));

    const result = (await run(caps, profile, signed)) as { ok: true; value: Receipt };
    const [record] = caps.log();
    expect(record).toEqual({
      cursor: result.value.cursor,
      recordedAt: 42,
      event: { id, sequence: 1 },
      entry: signed,
      presentedAt: null,
    });
    expect(result.value.operationId).toBe(signed.command.operationId);
  });

  it("a command that names no event is recorded against none", async () => {
    const { caps } = await setup();
    const run = createExecute(acceptingHandlers());
    const organiser = await registered(caps);
    const signed = await sign(
      organiser,
      commandOf("registerCredential", eventId(), { account: organiser.account }),
    );
    expect((await run(caps, profile, signed)).ok).toBe(true);
    expect(caps.log()[0]?.event).toBeNull();
  });

  it("a write that throws rolls back every write, the log and the operation record", async () => {
    const { caps } = await setup();
    const handler: CommandHandler<never> = async ({ tx, command }) =>
      accept(async () => {
        await tx.putEvent(
          event((command as { event: EventId }).event, "00" as AccountId, "Active"),
        );
        throw new Error("store failure");
      });
    const run = createExecute(
      Object.fromEntries(Object.keys(v0Handlers).map((k) => [k, handler])) as never,
    );
    const organiser = await registered(caps);
    const id = eventId();
    const signed = await sign(organiser, commandOf("createEvent", id));

    await expect(run(caps, profile, signed)).rejects.toThrow("store failure");
    expect(caps.log()).toHaveLength(0);
    expect(await caps.registry.getEvent(id)).toBeNull();
    expect(await caps.registry.getOperation(signed.command.operationId)).toBeNull();
  });
});

describe("execute — defects", () => {
  it("throws for a command carrying presentedAt", async () => {
    const { caps } = await setup();
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));
    await expect(execute(caps, profile, signed, { presentedAt: 1 })).rejects.toThrow(TypeError);
  });
});
