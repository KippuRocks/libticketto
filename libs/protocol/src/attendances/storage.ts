import type { AccountId, Event, EventId, TicketId, Timestamp } from "@ticketto/types";

/**
 * Access to storage for module attendances.
 */
export interface AttendancesStorage {
  /**
   * Returns the list of attendances associated to a ticket.
   * @param id The {@link EventId} bound to the queried ticket.
   * @param ticketId The {@link TicketId} associated to the queried ticket.
   */
  attendances(id: EventId, ticketId: TicketId): Promise<Timestamp[]>;
}
