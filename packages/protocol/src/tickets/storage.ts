import type {
  AccountId,
  EventId,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/types";

/**
 * Access to storage for module tickets.
 */
export interface TicketsStorage {
  /**
   * Returns the list of the tickets for an event.
   * @param eventId The {@link EventId} of the event.
   */
  all(eventId: EventId): Promise<Ticket[]>;

  /**
   * Returns the list of tickets owned by a *ticket holder*.
   * @param ticketHolder The {@link AccountId} for a *ticket holder*.
   */
  ticketHolderOf(ticketHolder: AccountId, eventId?: EventId): Promise<Ticket[]>;

  /**
   * Returns the details of the ticket.
   * @param issuer The {@link EventId} of the event that issues the ticket.
   * @param id The {@link TicketId} of a ticket.
   */
  get(eventId: EventId, id: TicketId): Promise<Ticket | undefined>;

  /**
   * Returns the list of attendances associated to a ticket.
   * @param id The {@link EventId} bound to the queried ticket.
   * @param ticketId The {@link TicketId} associated to the queried ticket.
   */
  attendances(eventId: EventId, id: TicketId): Promise<Timestamp[]>;

  /**
   * Returns the list of pending transfers where {@link who} is either the
   * sender or the recipient of the ticket.
   * @param who The {@link AccountId} of a ticket holder might send or receive
   * a pending transfer.
   */
  pendingTransfersFor(who: AccountId): Promise<Ticket[]>;

  /**
   * Produces a signed call with the attendance request, ready to be submitted
   * by an external provider.
   *
   * @param issuer The {@link EventId} of the event that issues the ticket.
   * @param id The {@link TicketId} of a ticket.
   * @returns the payload to request an attendance.
   */
  attendanceRequest(eventId: EventId, id: TicketId): Promise<Uint8Array>;
}
