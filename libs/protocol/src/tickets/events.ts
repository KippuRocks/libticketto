import { AccountId, EventId, LineItemPrice, TicketId } from "@ticketto/types";

import type { TicketsModule } from "./index.js";

/**
 * The events that might arise from the interactions with the {@link TicketsModule}
 */
export type TicketsEvent =
  | TicketIssued
  | TicketOnSale
  | TicketPurchased
  | TicketTransferred;

/**
 * A new ticket has been issued for an active event.
 */
export type TicketIssued = {
  type: "TicketIssued";
  event: EventId;
  id: TicketId;
};

/**
 * A ticket has been marked for sale with a specified price. Can be listed as available by
 * clients.
 */
export type TicketOnSale = {
  type: "TicketOnSale";
  event: EventId;
  id: TicketId;
  price: LineItemPrice;
};

/**
 * A ticket has been purchased by a customer and should be delisted
 * as avaailable on clients.
 */
export type TicketPurchased = {
  type: "TicketPurchased";
  event: EventId;
  id: TicketId;
  buyer: AccountId;
};

/**
 * A ticket has been transferred between customers.
 */
export type TicketTransferred = {
  type: "TicketTransferred";
  issuer: EventId;
  id: TicketId;
  newOwner: AccountId;
};
