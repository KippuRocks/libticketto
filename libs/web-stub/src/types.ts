import { AccountId, Event, EventId, Ticket, TicketId } from "@ticketto/types";

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
    key: [AccountId, EventId, TicketId];
    value: Ticket;
    indexes: {
      owner: AccountId;
      ownerIssuer: [AccountId, EventId];
      issuerId: [EventId, TicketId];
      id: [AccountId, EventId, TicketId];
    };
  };
}
