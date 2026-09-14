// `query` — features/008-ledger-rules/plan.md §5.1, §5.3.
//
// Point queries over the registry, outside any transaction: a query writes
// nothing (`REQ-Q-1`) and nothing enumerates (`REQ-MG-5`).

import type { Event, Profile, Query, QueryResult, Result, Ticket } from "@ticketto/sdk";
import type { Capabilities, TicketRecord } from "./capabilities.js";
import { err, ok } from "./result.js";

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
        const event: Event | null = await caps.registry.getEvent(q.event);
        return event === null ? err("ERR-EventNotFound") : ok(event);
      }
      case "getTicket": {
        const ticket = await caps.registry.getTicket(q.ticket);
        return ticket === null ? err("ERR-TicketNotFound") : ok(publicTicket(ticket));
      }
      case "canAttend": {
        if ((await caps.registry.getEvent(q.event)) === null) return err("ERR-EventNotFound");
        if ((await caps.registry.getTicket(q.ticket)) === null) return err("ERR-TicketNotFound");
        throw new Error("canAttend is not implemented yet (T-008-09)");
      }
      case "getCancellationHolder": {
        if ((await caps.registry.getTicket(q.ticket)) === null) return err("ERR-TicketNotFound");
        throw new Error("getCancellationHolder is not implemented yet (T-008-09)");
      }
      default:
        throw new Error(`unknown query ${(q as Query).kind}`);
    }
  };
  return (await answer()) as Result<QueryResult<Q>>;
}
