import type { AccountId, Event, EventId } from "@ticketto/types";

/**
 * Calls to interact with events module.
 */
export interface EventsCalls {
  /**
   * Creates a new event, to be owned by `owner`
   * @param owner The {@link AccountId} associated to the owner of the event.
   * @param event The details of the event to be created
   * @returns The {@link EventId} of the newly created event
   * @throws In case the event couldn't be created
   */
  createEvent(owner: AccountId, event: Omit<Event, "id">): Promise<EventId>;

  /**
   * Updates the information of an event.
   * @param id The {@link EventId} of the event to be updated
   * @param event The details of the event to update
   * @throws An error in case the event couldn't be updated
   */
  update(id: EventId, event: Partial<Omit<Event, "id">>): Promise<void>;

  /**
   * Sets the ownership on another account.
   * @param event The event to be created
   * @throws An error if the signer of the command
   */
  transferOwner(id: EventId, newOwner: Omit<Event, "id">): Promise<void>;
}
