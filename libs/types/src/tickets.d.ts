import type { EventId } from "./events.d.ts";
import type { Timestamp } from "./primitives.d.ts";
import type { LineItem } from "./product.d.ts";

export type TicketId = number;

export type Ticket = {
  /**
   * A unique identifier for the ticket
   */
  id: TicketId;
  /**
   * The identifier for the ticket event
   */
  eventId: EventId;
  /**
   * A SEO-friendly name for the ticket, available on indexers
   */
  name: string;
  /**
   * A SEO-friendly description for the ticket, available on indexers
   */
  description: string;
  /**
   * An image of the ticket art
   */
  image: string | URL;
  /**
   * A list of possible attendances for the ticket
   */
  attendances: Timestamp[];
  /**
   * A flag marking whther the ticket is available for direct sale
   */
  forSale: boolean;
  /**
   * The attendance policy for the ticket
   */
  attedancePolicy: AttendancePolicy;
  /**
   * The restrictions associated to the ticket
   */
  restrictions: TicketRestrictions;
};

export type AttendancePolicy = {
  type: AttendancePolicyType.Single;
} | {
  type: AttendancePolicyType.Multiple;
  max: number;
  until: Timestamp;
} | {
  type: AttendancePolicyType.Unlimited,
  until: Timestamp;
};

export enum AttendancePolicyType {
  Single = 'Single',
  Multiple = 'Multiple',
  Unlimited = 'Unlimited'
};

export type TicketRestrictions = {
  /** Determines if a ticket is not for resale (i.e. exclusive events, scolarships) */
  cannotResale: boolean;
  /** Determines if a ticket is not able to be transfered to other accounts (i.e. scolarships) */
  cannotTransfer: boolean
};