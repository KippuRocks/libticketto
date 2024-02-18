import type { AccountId, Event, EventId, Ticket } from "@ticketto/types";

/**
 * Access to storage for module tickets.
 */
export interface TicketsStorage {
  /**
   * Returns the list of tickets owned by a *ticket holder*.
   * @param ticketHolder The {@link AccountId} for a *ticket holder*.
   */
  ticketHolderOf(ticketHolder: AccountId): Promise<Ticket[]>;

  /**
   * Returns the details of the ticket.
   * @param issuer The {@link EventId} of the event that issues the ticket.
   * @param id The {@link TicketId} of a ticket.
   */
  get(issuer: EventId, id: TicketId): Promise<Ticket>;

  /**
   * Returns the payload to request an attendance.
   * @param issuer The {@link EventId} of the event that issues the ticket.
   * @param id The {@link TicketId} of a ticket.
   */
  attendanceRequest(issuer: EventId, id: Ticket): Promise<Uint8Array>;
}
