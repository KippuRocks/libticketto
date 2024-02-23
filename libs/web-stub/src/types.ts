import {
  AccountId,
  Event,
  EventId,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/types";

import { DBSchema } from "idb";

export type Account = { id: AccountId; balance: number };

export type StubConsumerSettings = {
  databaseName?: string;
  genesisConfig?: StubGenesisConfig;
};

export type StubGenesisConfig = {
  accounts?: Account[];
  events?: Event[];
  tickets?: Ticket[];
};

export interface TickettoDBSchema extends DBSchema {
  accounts: {
    key: AccountId;
    value: Account;
    indexes: { id: AccountId };
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
