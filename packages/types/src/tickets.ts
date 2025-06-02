import type {
  FileLocation,
  HexString,
  Metadata,
  Timestamp,
} from "./primitives.ts";

import { AccountId } from "./account.ts";
import type { EventId } from "./events.ts";
import type { LineItemPrice } from "./product.ts";

/**
 * A type that represents the unique identifier of a ticket class.
 */
export type TicketClassId = HexString;

/**
 * A specific class of ticket that is issued for attending to an event.
 */
export type TicketClass = {
  /**
   * The attendance policy for a ticket. This defines how to validate
   * whether marking an attendance for a ticket should be accepted or not.
   */
  attendancePolicy: AttendancePolicy;
  /**
   * The price for the tickets sold for this event.
   */
  ticketprice: LineItemPrice;
  /**
   * The restrictions imposed on the tickets sold for this event.
   */
  ticketRestrictions: TicketRestrictions;
  /** A descriptive message for users to understand what this class
   * means (e.g. Early Bird, VIP) */
  description?: string;
  /** JSON Schema that specifies metadata (e.g. location,
   * tier, acommodations) associated to the class */
  metadata?: Metadata;
  /** A series of (business-logic) requirements the seller might
   * require when issuing a ticket instance of this class */
  constraints?: Record<string, unknown>;
  /**
   * The maxmimum number of ticket instances that can be issued for
   * this class. Cannot be greater than the capacity of the event.
   */
  maxIssuance?: number;
};

/**
 * A type that represents the unique identifier of an event's ticket.
 */
export type TicketId = bigint;

/**
 * This structure represents a ticket.
 */
export type Ticket<FileLike = FileLocation> = {
  /**
   * The identifier for the ticket event.
   */
  eventId: EventId;
  /**
   * A unique identifier for the ticket.
   */
  id: TicketId;
  /**
   * The account that owns the ticket.
   */
  owner: AccountId;
  /**
   * The attendance policy of this ticket.
   */
  attendancePolicy: AttendancePolicy;
  /**
   * A list of possible attendances for the ticket.
   */
  attendances: Timestamp[];
  /**
   * Optional metadata that is visible when attached on a ticket.
   */
  metadata?: TicketMetadata<FileLike>;
  /**
   * A flag marking whther the ticket is available for direct sale.
   */
  readonly forSale: boolean;
  /**
   * If the ticket is available for sale, indicate the item's price.
   */
  price?: LineItemPrice;
  /**
   * The restrictions associated to the ticket.
   */
  restrictions?: TicketRestrictions;
};

/**
 * This structure represents the metadata attached to a ticket.
 */
export type TicketMetadata<FileLike> = Metadata & {
  /**
   * A SEO-friendly description for the ticket, available on indexers.
   */
  description?: string;
  /**
   * An image of the ticket art.
   */
  ticketArt?: FileLike;
};

/**
 * Represents the types of attendance policies available
 * in the protocol.
 */
export enum AttendancePolicyType {
  Single = "Single",
  Multiple = "Multiple",
  Unlimited = "Unlimited",
}

/**
 * The attendance policy of a ticket. Can be either a single entrance, a multiple entrance
 * (with an optional until date), or an unlimited entrance (with an optional until date).
 */
export type AttendancePolicy =
  | {
      type: AttendancePolicyType.Single;
    }
  | {
      type: AttendancePolicyType.Multiple;
      max: number;
      until?: Timestamp;
    }
  | {
      type: AttendancePolicyType.Unlimited;
      until?: Timestamp;
    };

/**
 * Determines which restrictions are enforced system-level for a ticket.
 */
export type TicketRestrictions = {
  /** Determines if a ticket is not for resale (i.e. exclusive events, scolarships) */
  cannotResale: boolean;
  /** Determines if a ticket is not able to be transfered to other accounts (i.e. scolarships) */
  cannotTransfer: boolean;
};
