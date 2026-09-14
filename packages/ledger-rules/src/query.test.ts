// T-008-02: point queries over the registry (features/008-ledger-rules/plan.md §5.1).

import type { AccountId, ClassId, Event, TicketId, ZoneId } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities } from "../test/fake-capabilities.js";
import { eventId, id32, profile } from "../test/fixtures.js";
import { query } from "./query.js";

describe("query", () => {
  it("answers getEvent with the recorded event, without the rules' bookkeeping", async () => {
    const caps = createFakeCapabilities();
    const event: Event = {
      id: eventId(),
      owner: id32<AccountId>(),
      status: "Active",
      maxCapacity: null,
      issued: 1,
      zones: [{ id: id32<ZoneId>(), kind: "Seated" }],
    };
    await caps.registry.putEvent({ ...event, zonesInUse: [event.zones[0]?.id ?? id32<ZoneId>()] });
    expect(await query(caps, profile, { kind: "getEvent", event: event.id })).toEqual({
      ok: true,
      value: event,
    });
  });

  it("answers getTicket with the ticket's facts, without the rules' bookkeeping", async () => {
    const caps = createFakeCapabilities();
    const ticket = {
      id: id32<TicketId>(),
      event: eventId(),
      holder: id32<AccountId>(),
      class: "01" as ClassId,
      provenance: "Granted" as const,
      zone: id32<ZoneId>(),
      placement: { kind: "Seated" as const, position: "0a" as never },
      policy: { kind: "Single" as const },
      restrictions: { cannotResale: true, cannotTransfer: false },
      attendances: 0,
    };
    await caps.registry.insertTicket(ticket);
    expect(await query(caps, profile, { kind: "getTicket", ticket: ticket.id })).toEqual({
      ok: true,
      value: ticket,
    });
  });
});
