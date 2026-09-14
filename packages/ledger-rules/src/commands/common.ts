// Checks several command handlers share (features/008-ledger-rules/plan.md §5.2).

import type { AccountId, TickettoError } from "@ticketto/sdk";
import type { EventRecord } from "../capabilities.js";
import { error } from "../result.js";

/**
 * The event a handler's command names. `execute` has already refused a missing
 * one with `ERR-EventNotFound`, so its absence here is a defect.
 */
export function existingEvent(event: EventRecord | null): EventRecord {
  if (event === null) throw new Error("the named event was not checked for existence");
  return event;
}

/** The signer owns the event → `ERR-NotOwner`. */
export function ownerCheck(event: EventRecord, signer: AccountId): TickettoError | null {
  return event.owner === signer ? null : error("ERR-NotOwner", "the signer does not own the event");
}

/**
 * The event is `Active` → `ERR-EventSealed` / `ERR-EventCancelled` (`REQ-EV-8`).
 * `Finished` is refused before any handler runs (`INV-16`).
 */
export function activeCheck(event: EventRecord): TickettoError | null {
  switch (event.status) {
    case "Active":
      return null;
    case "Sealed":
      return error("ERR-EventSealed", "the event is Sealed");
    case "Cancelled":
      return error("ERR-EventCancelled", "the event is Cancelled");
    default:
      return error("ERR-EventFinished", "the event is Finished");
  }
}
