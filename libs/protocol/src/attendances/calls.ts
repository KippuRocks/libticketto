import type { AccountId, Event, EventId, TicketId } from "@ticketto/types";

/**
 * Calls to interact with attendances module.
 */
export interface AttendancesCalls {
  /**
   * Creates a hex-encoded signed call to mark an attendance using the given ticket identification
   * @param id An {@link EventId} of the event for which the attendee will mark an attendance.
   * @param ticketId A {@link TicketId} of the ticket the attendee will 
   * @returns The signed call to mark the attendance.
   * @throws In case the call cannot be correctly signed.
   */
  create(id: EventId, ticketId: TicketId): Promise<string>;

  /**
   * Updates the information of an event call to mark an attendance to an event with a valid ticket.
   * @param call A hex-encoded signed call to mark the attendance.
   * @returns A confirmation that the attendance was marked successfully.
   * @throws An error in case the attendance is not valid.
   */
  submit(call: string): Promise<void>;

}
