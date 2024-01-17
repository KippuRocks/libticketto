import { AccountId } from "./account.js";
import { EventId } from "./events.js";
import { TicketId } from "./tickets.js";

export type TicketPalletEnum = {
  Event: string | null;
  Call: string | null;
};

type CheckInEvent = {
  who: AccountId;
  ticket: [EventId, TicketId];
  when: number;
};

export type TicketEvent =
  | {
    CheckinConfirmed: CheckInEvent;
  }
  | {
    CheckinRejected: CheckInEvent;
  };
