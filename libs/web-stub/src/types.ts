import {
  Account,
  AccountId,
  Event,
  EventId,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/types";

import { DBSchema } from "idb";
import { TicketAttendance } from "./attendances.ts";

export type StubConsumerSettings = {
  databaseName?: string;
  genesisConfig?: StubGenesisConfig;
};

export type StubGenesisConfig = {
  attendances?: TicketAttendance[];
  accounts?: Account[];
  events?: Event[];
  tickets?: Ticket[];
};

export interface TickettoDBSchema extends DBSchema {
  attendances: {
    key: [EventId, TicketId];
    value: TicketAttendance;
    indexes: {
      id: [EventId, TicketId];
    };
  };
  accounts: {
    key: AccountId;
    value: Account;
    indexes: { id: AccountId; display: string; phone: string; email: string };
  };
  events: {
    key: EventId;
    value: Event;
    indexes: { id: EventId; owner: AccountId };
  };
  tickets: {
    key: [EventId, TicketId];
    value: Ticket;
    indexes: {
      id: [EventId, TicketId];
      owner: AccountId;
      ownerIssuer: [AccountId, EventId];
    };
  };
  migrations: {
    key: Timestamp;
    value: { id: Timestamp; name: string };
  };
}
