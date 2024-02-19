import type { AccountId, Event, EventId } from "@ticketto/types";

export interface EventsStorage {
  /**
   * Returns a list of the tickets owned by an organizer.
   * @param owner The {@link AccountId} for the _event organizer_ that owns an event
   */
  organizerOf(owner: AccountId): Promise<Event[]>;

  /**
   * Returns a list of events for which an account holds tickets.
   * @param ticketHolder The {@link AccountId} of a _ticket holder_.
   */
  ticketHolderOf(ticketHolder: AccountId): Promise<Event[]>;

  /**
   * Returns the details of the event.
   * @param id The {@link EventId} of the event to be fetched
   */
  get(id: EventId): Promise<Event>;
}
