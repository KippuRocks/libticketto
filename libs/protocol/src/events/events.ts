import { AccountId, EventId } from "@ticketto/types";

import { EventsModule } from "./index.js";

/**
 * The events that might be raised as a result of interactions with the {@link EventsModule}.
 */
export type EventsEvent =
  | EventCreated
  | EventUpdated
  | EventOwnershipTransferred;

/**
 * A new event has been created, and thus it's able to be listed in clients.
 */
export type EventCreated = {
  type: "EventCreated";
  id: EventId;
  owner: AccountId;
};

/**
 * The base information of an event has been updated, and some fetching
 * might be needed by clients.
 */
export type EventUpdated = {
  type: "EventUpdated";
  id: EventId;
};

/**
 * The event has been transferred and is now owned by a different
 * organizer. This might imply changes in conditions in the future.
 */
export type EventOwnershipTransferred = {
  type: "EventOwnershipTransferred";
  id: EventId;
  newOwner: AccountId;
};
