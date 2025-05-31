import { AccountId, EventId, TicketId, Timestamp } from "@ticketto/types";

export type AttandancesEvent = AttendanceMarked;

export type AttendanceMarked = {
  type: "AttendanceMarked";
  issuer: EventId;
  id: TicketId;
  owner: AccountId;
  time: Timestamp;
};
