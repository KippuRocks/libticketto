import type { AccountId, Event, EventId } from "@ticketto/types";

export interface EventsStorage {
  /**
   * Returns a list of all the currently active events.
   */
  all(): Promise<Event[]>;

  /**
   * Returns a list of the events organised by {@link who}.
   * @param who The {@link AccountId} for an _event organizer_.
   */
  organizerOf(who: AccountId): Promise<Event[]>;

  /**
   * Returns a list of events for which {@link who} holds tickets.
   * @param who The {@link AccountId} of a _ticket holder_.
   */
  ticketHolderOf(who: AccountId): Promise<Event[]>;

  /**
   * Returns the details of the event.
   * @param id The {@link EventId} of the event to be fetched
   */
  get(id: EventId): Promise<Event | undefined>;
}
