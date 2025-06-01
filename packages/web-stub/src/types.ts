import {
  Account,
  AccountId,
  Event,
  EventId,
  Ticket,
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
    key: [EventId, number];
    value: Omit<TicketAttendance, "id"> & { id: number };
    indexes: {
      id: [EventId, number];
    };
  };
  accounts: {
    key: AccountId;
    value: Account;
    indexes: { id: AccountId; display: string; phone: string; email: string };
  };
  events: {
    key: number;
    value: Event;
    indexes: { id: number; owner: AccountId };
  };
  tickets: {
    key: [EventId, number];
    value: Omit<Ticket, "id"> & { id: number };
    indexes: {
      id: [EventId, number];
      owner: AccountId;
      ownerIssuer: [AccountId, EventId];
    };
  };
  migrations: {
    key: number;
    value: { id: Timestamp; name: string };
  };
}
