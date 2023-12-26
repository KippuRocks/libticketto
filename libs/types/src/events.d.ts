import type { DateRange, FileLike } from "./primitives.d.ts";
import type { LineItemPrice } from "./product.d.ts";

/**
 * A single instance of a gathering (either single-dated or multi-dated)
 * that issues tickets for attendees to participate in.
 */
export type Event = {
  /** An unique identifier of the event */
  id: number;
  /** The name that identifies the event */
  name: string;
  /** A brief description used for the reader to get a glance of what
   * the event is in a tickets marketplace */
  description: string;
  /** A file or location to a file  */
  banner: FileLike;
  /** A list of date ranges defining the dates of the event. Minimum
   * one for an event of one day. Multiple ranges are defined for
   * multi-day events. */
  dates: DateRange[];
  /** A list of possible classes of tickets. Each ticket class
   * is a template that will be used to issue an instance */
  ticketClasses: EventTicketClass[];
};

/**
 * A specific class of ticket that might be issued for attending
 * to an event.
 */
export type EventTicketClass = {
  /** Unique identifier of the class */
  id: string;
  /** A descriptive message for users to understand what this class
   * means (e.g. Early Bird, VIP) */
  description: string;
  /** JSON Schema that specifies metadata (e.g. location,
   * tier, acommodations) associated to the class */
  metadata?: Record<string | number | symbol, unknown>;
  /** The price for this ticket type */
  price: LineItemPrice;
  /** A series of (business-logic) requirements the seller might
   * require when issuing a ticket instance of this class */
  constraints?: Record<string, unknown>;
  /** A range of dates for when this class of ticket can be sold.
   * By default, is calculated based on the event's dates */
  sellingDates?: DateRange;
};
