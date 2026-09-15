// `query` — features/008-ledger-rules/plan.md §5.1, §5.3.
//
// Point queries over the registry, outside any transaction: a query writes
// nothing (`REQ-Q-1`) and nothing enumerates (`REQ-MG-5`).

import type { Event, Profile, Query, QueryResult, Result, Ticket } from "@ticketto/sdk";
import { attendanceVerdict } from "./attendance.js";
import type { Capabilities, EventRecord, TicketRecord } from "./capabilities.js";
import { err, ok } from "./result.js";

/** An event as the SDK surface presents it: its §5.1 facts, without the rules' bookkeeping. */
function publicEvent(record: EventRecord): Event {
  const { zonesInUse: _, ...event } = record;
  return event;
}

/** A ticket as the SDK surface presents it: its §5.2 facts, without the rules' bookkeeping. */
function publicTicket(record: TicketRecord): Ticket {
  const { cancellationHolder: _, ...ticket } = record;
  return ticket;
}

/** Answers one point query. */
export async function query<Q extends Query>(
  caps: Capabilities,
  _profile: Profile,
  q: Q,
): Promise<Result<QueryResult<Q>>> {
  const answer = async (): Promise<Result<unknown>> => {
    switch (q.kind) {
      case "getEvent": {
        const event = await caps.registry.getEvent(q.event);
        return event === null ? err("ERR-EventNotFound") : ok(publicEvent(event));
      }
      case "getTicket": {
        const ticket = await caps.registry.getTicket(q.ticket);
        return ticket === null ? err("ERR-TicketNotFound") : ok(publicTicket(ticket));
      }
      case "canAttend": {
        const event = await caps.registry.getEvent(q.event);
        if (event === null) return err("ERR-EventNotFound");
        // A ticket of another event does not exist in the event named (INV-1, plan §5.7a).
        const ticket = await caps.registry.getTicket(q.ticket);
        if (ticket === null || ticket.event !== q.event) return err("ERR-TicketNotFound");
        // Judged at the authority's clock (REQ-Q-2: "current time").
        return ok(attendanceVerdict(event, ticket, caps.clock.now()));
      }
      case "getCancellationHolder": {
        const ticket = await caps.registry.getTicket(q.ticket);
        if (ticket === null) return err("ERR-TicketNotFound");
        const event = await caps.registry.getEvent(ticket.event);
        if (event === null) throw new Error(`ticket ${ticket.id} of a missing event`);
        // Plan §5.5: the holder at cancellation is the lazy snapshot, else the holder,
        // who has not changed since. No holder is fixed until the event is Cancelled.
        return ok(
          event.status === "Cancelled" ? (ticket.cancellationHolder ?? ticket.holder) : null,
        );
      }
      case "getCredential": {
        // One registration by (account, credential); the account's others stay unexposed (REQ-MG-5).
        const registrations = await caps.registry.getRegistrations(q.account);
        const found = registrations.find(({ credential }) => credential === q.credential);
        return ok(found === undefined ? null : found.registration);
      }
      default:
        throw new Error(`unknown query ${(q as Query).kind}`);
    }
  };
  return (await answer()) as Result<QueryResult<Q>>;
}
