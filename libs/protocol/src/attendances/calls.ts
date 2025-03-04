import type { AccountId, Event, EventId, TicketId } from "@ticketto/types";

/**
 * Calls to interact with attendances module.
 */
export interface AttendancesCalls {
  /**
   * Updates the information of an event call to mark an attendance to an event with a valid ticket.
   * @param call A hex-encoded signed call to mark the attendance.
   * @returns A confirmation that the attendance was marked successfully.
   * @throws An error in case the attendance is not valid.
   */
  submit(call: Uint8Array): Promise<void>;
}
