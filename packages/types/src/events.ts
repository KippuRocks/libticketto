import type { DateRange, FileLocation } from "./primitives.ts";
import { TicketClass, TicketId } from "./tickets.js";

import type { AccountId } from "./account.ts";

/**
 * A type that represents the unique identifier of an event.
 */
export type EventId = number;

/**
 * A single instance of a gathering (either single-dated or multi-dated)
 * that issues tickets for attendees to participate in.
 *
 * Note: This structure is provisional. For the final version of the protocol, it is
 * expected to detach the {@link TicketClass} from the event, and have a list (or map)
 * of ticket classes attached to the event instead.
 */
export type Event<FileLike = FileLocation> = {
  /** An unique identifier of the event */
  readonly id: EventId;
  /**
   * The account that owns the events
   */
  organiser: AccountId;
  /** The name that identifies the event */
  name: string;
  /** The metadata associated to the event. */
  metadata?: EventMetadata<FileLike>;
  /**
   * The maximum capacity for an event, indicates how many ticket
   * instances can be issued for it.
   */
  capacity: TicketId;
  /** A list of date ranges defining the dates of the event. Minimum
   * one for an event of one day. Multiple ranges are defined for
   * multi-day events. */
  dates?: DateRange[];
  /**
   * The ticket class defined for this event. This is used to define
   * the features of a ticket when issuing one.
   */
  class: TicketClass;
  /**
   * The date range for the next available date of the event. In the case
   * of single day events, this will always return the range of the event
   * date.
   */
  readonly date?: DateRange;
  /**
   * The status of the event.
   */
  readonly state: EventState;
};

/**
 * An enum which represents the status of the event.
 */
export enum EventState {
  /** The initial state. Tickets cannot be issued. */
  Created,
  /**
   * The event is now ready to be sold. Tickets can be issued, but not used. Capacity cannot be
   * modified, but ticket's details can still be set.
   */
  Sales,
  /**
   * The first date in the list of dates has begun. Tickets can be issued, and used. Dates cannot
   * longer be modified.
   */
  Ongoing,
  /** The last date in the list of dates has finished. Tickets can no longer be issued. */
  Finished,
}

/**
 * A structure that includes the content of the metadata attached to an event.
 */
export type EventMetadata<FileLike> = {
  /** A brief description used for the reader to get a glance of what
   * the event is in a tickets marketplace */
  description?: string;
  /** A file or location to a file  */
  banner?: FileLike;
};
