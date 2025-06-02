import {
  Account,
  AccountId,
  AccountIdentity,
  Event,
  EventId,
  Ticket,
} from "@ticketto/types";

import { DBSchema } from "idb";

export type StubConsumerSettings = {
  databaseName?: string;
  genesisConfig?: StubGenesisConfig;
};

export type StubGenesisConfig = {
  accounts?: TickettoDBSchema["Accounts"]["value"][];
  events?: TickettoDBSchema["Events"]["value"][];
  tickets?: TickettoDBSchema["Tickets"]["value"][];
  attendances?: TickettoDBSchema["Attendances"]["value"][];
  metadata?: TickettoDBSchema["Metadata"]["value"][];
};

export interface TickettoDBSchema extends DBSchema {
  Accounts: {
    key: Account["id"];
    value: Account;
    indexes: {
      id: Account["id"];
      display: AccountIdentity["display"];
      phone: AccountIdentity["phone"];
      email: AccountIdentity["email"];
    };
  };
  Events: {
    key: Event["id"];
    value: EventDB;
    indexes: { id: number; organiser: AccountId };
  };
  Tickets: {
    key: [TicketDB["eventId"], TicketDB["id"]];
    value: TicketDB;
    indexes: {
      event: TicketDB["eventId"];
      id: [TicketDB["eventId"], TicketDB["id"]];
      owner: TicketDB["owner"];
      ownerEvent: [TicketDB["owner"], TicketDB["eventId"]];
    };
  };
  PendingTransfers: {
    key: PendingTransfer["id"];
    value: PendingTransfer;
    indexes: {
      sender: PendingTransfer["sender"];
      beneficiary: PendingTransfer["beneficiary"];
    };
  };
  Attendances: {
    key: [TicketAttendance["eventId"], TicketAttendance["id"]];
    value: TicketAttendance;
  };
  Metadata: {
    key: [DBMetadata["type"], DBMetadata["id"]];
    value: DBMetadata;
  };
  Migrations: {
    key: Migration["id"];
    value: Migration;
  };
}

export type EventDB = Omit<Event, "date" | "metadata">;

export type TicketDB = Omit<
  Ticket,
  "id" | "metadata" | "attendances" | "forSale"
> & {
  id: number;
};

export type TicketAttendance = {
  eventId: EventId;
  id: number;
  attendances: number[];
};

export type DBMetadata = {
  type: "event" | "ticket";
  id: number;
  [k: string | number]: unknown | undefined;
};

export type PendingTransfer = {
  id: [EventId, number];
  sender: AccountId;
  beneficiary: AccountId;
};

export type Migration = {
  id: number;
  name: string;
};

export const zero = {
  free: 0n,
  reserved: 0n,
  frozen: 0n,
};
