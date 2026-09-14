// T-008-13: not-found checks, with the codes amendment 0003 ruled
// (features/008-ledger-rules/plan.md §5.2, SPEC.md §10).

import type { AccountId, CommandKind, EventId, Result, TicketId } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import {
  commandOf,
  EXISTING_EVENT_COMMAND_KINDS,
  EXISTING_TICKET_COMMAND_KINDS,
  ticketIn,
} from "../test/commands.js";
import { createFakeCapabilities } from "../test/fake-capabilities.js";
import { credential, eventId, id32, profile, registered, sign } from "../test/fixtures.js";
import type { EventRecord } from "./capabilities.js";
import { execute } from "./execute.js";
import { query } from "./query.js";

function activeEvent(id: EventId, owner: AccountId): EventRecord {
  return { id, owner, status: "Active", maxCapacity: null, issued: 0, zones: [], zonesInUse: [] };
}

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

/** The ticket id a command names, if any. */
function ticketOf(kind: CommandKind, command: object): TicketId {
  if (!EXISTING_TICKET_COMMAND_KINDS.includes(kind)) throw new Error(`${kind} names no ticket`);
  return (command as { ticket: TicketId }).ticket;
}

describe("commands against what does not exist", () => {
  it.each(EXISTING_EVENT_COMMAND_KINDS)(
    "ERR-EventNotFound: %s against a missing event, changing nothing",
    async (kind) => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      const signed = await sign(organiser, commandOf(kind, eventId()));

      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventNotFound");
      expect(caps.log()).toHaveLength(0);
      expect(await caps.registry.getOperation(signed.command.operationId)).toBeNull();
    },
  );

  it.each(EXISTING_TICKET_COMMAND_KINDS)(
    "ERR-TicketNotFound: %s against a missing ticket of an existing event, changing nothing",
    async (kind) => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      const id = eventId();
      await caps.registry.putEvent(activeEvent(id, organiser.account));
      const signed = await sign(organiser, commandOf(kind, id));

      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-TicketNotFound");
      expect(caps.log()).toHaveLength(0);
    },
  );

  it.each(EXISTING_TICKET_COMMAND_KINDS)(
    "ERR-TicketNotFound: %s naming a ticket of another event, changing nothing (INV-1)",
    async (kind) => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      const named = eventId();
      const other = eventId();
      await caps.registry.putEvent(activeEvent(named, organiser.account));
      await caps.registry.putEvent(activeEvent(other, organiser.account));
      const command = commandOf(kind, named);
      await caps.registry.insertTicket(ticketIn(other, ticketOf(kind, command), organiser.account));
      const signed = await sign(organiser, command);

      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-TicketNotFound");
      expect(caps.log()).toHaveLength(0);
    },
  );

  it.each(EXISTING_TICKET_COMMAND_KINDS)(
    "ERR-EventNotFound: %s against a missing event is reported before its ticket",
    async (kind) => {
      const caps = createFakeCapabilities();
      const organiser = await registered(caps);
      const signed = await sign(organiser, commandOf(kind, eventId()));
      expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventNotFound");
    },
  );

  it("ERR-EventNotFound: checked first — before expiry, replay and authorisation (plan §5.2)", async () => {
    const caps = createFakeCapabilities();
    const signed = await sign(
      credential(),
      commandOf("setEventStatus", eventId(), { expiresAt: 10 }),
    );
    caps.clock.set(11);
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-EventNotFound");
  });

  it("ERR-TicketNotFound: a ticket that exists passes the check", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const id = eventId();
    await caps.registry.putEvent(activeEvent(id, organiser.account));
    const command = commandOf("transferTicket", id);
    await caps.registry.insertTicket(
      ticketIn(id, ticketOf("transferTicket", command), organiser.account),
    );
    const signed = await sign(organiser, command);
    // Past the not-found check, the unimplemented handler is reached.
    await expect(execute(caps, profile, signed)).rejects.toThrow("not implemented");
  });

  it("createEvent names an event yet to exist, and is not refused as not found", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const signed = await sign(organiser, commandOf("createEvent", eventId()));
    expect(codeOf(await execute(caps, profile, signed))).not.toBe("ERR-EventNotFound");
  });

  it("issueTicket names a ticket yet to exist, and is not refused as not found", async () => {
    const caps = createFakeCapabilities();
    const organiser = await registered(caps);
    const id = eventId();
    await caps.registry.putEvent(activeEvent(id, organiser.account));
    const signed = await sign(organiser, commandOf("issueTicket", id));
    expect(codeOf(await execute(caps, profile, signed))).not.toBe("ERR-TicketNotFound");
  });
});

describe("queries against what does not exist", () => {
  it("ERR-EventNotFound: getEvent of a missing event", async () => {
    const caps = createFakeCapabilities();
    expect(codeOf(await query(caps, profile, { kind: "getEvent", event: eventId() }))).toBe(
      "ERR-EventNotFound",
    );
  });

  it("ERR-TicketNotFound: getTicket of a missing ticket", async () => {
    const caps = createFakeCapabilities();
    expect(
      codeOf(await query(caps, profile, { kind: "getTicket", ticket: id32<TicketId>() })),
    ).toBe("ERR-TicketNotFound");
  });

  it("ERR-EventNotFound: canAttend against a missing event", async () => {
    const caps = createFakeCapabilities();
    const q = { kind: "canAttend", event: eventId(), ticket: id32<TicketId>() } as const;
    expect(codeOf(await query(caps, profile, q))).toBe("ERR-EventNotFound");
  });

  it("ERR-TicketNotFound: canAttend against a missing ticket of an existing event", async () => {
    const caps = createFakeCapabilities();
    const id = eventId();
    await caps.registry.putEvent(activeEvent(id, id32<AccountId>()));
    const q = { kind: "canAttend", event: id, ticket: id32<TicketId>() } as const;
    expect(codeOf(await query(caps, profile, q))).toBe("ERR-TicketNotFound");
  });

  it("ERR-TicketNotFound: canAttend naming a ticket of another event (INV-1)", async () => {
    const caps = createFakeCapabilities();
    const named = eventId();
    const other = eventId();
    await caps.registry.putEvent(activeEvent(named, id32<AccountId>()));
    await caps.registry.putEvent(activeEvent(other, id32<AccountId>()));
    const ticket = id32<TicketId>();
    await caps.registry.insertTicket(ticketIn(other, ticket, id32<AccountId>()));
    const q = { kind: "canAttend", event: named, ticket } as const;
    expect(codeOf(await query(caps, profile, q))).toBe("ERR-TicketNotFound");
  });

  it("ERR-TicketNotFound: getCancellationHolder of a missing ticket", async () => {
    const caps = createFakeCapabilities();
    const q = { kind: "getCancellationHolder", ticket: id32<TicketId>() } as const;
    expect(codeOf(await query(caps, profile, q))).toBe("ERR-TicketNotFound");
  });

  it("queries write nothing, found or not (REQ-Q-1)", async () => {
    const caps = createFakeCapabilities();
    await query(caps, profile, { kind: "getEvent", event: eventId() });
    await query(caps, profile, { kind: "getCancellationHolder", ticket: id32<TicketId>() });
    expect(caps.log()).toHaveLength(0);
  });
});
