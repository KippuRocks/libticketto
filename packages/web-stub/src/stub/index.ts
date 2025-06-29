import { AccountId, Get } from "@ticketto/types";
import { Container, interfaces } from "inversify";
import { WebStubEventsCalls, WebStubEventsStorage } from "../events.ts";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "../tickets.ts";

import { ClientAccountProvider } from "@ticketto/protocol";
import { IDBPTransaction, StoreNames, openDB, type IDBPDatabase } from "idb";
import {
  StubConsumerSettings,
  TickettoDBSchema,
  StubGenesisConfig,
} from "../types.ts";
import defaultMock from "./default-mock.ts";
import {
  WebStubDirectoryCalls,
  WebStubDirectoryStorage,
} from "../directory.ts";
import { EventQueue, WebStubEventSubscribtion } from "../subscriptions.ts";

export class Stub {
  #accountProvider: ClientAccountProvider = {
    getAccountId() {
      throw new Error("NotImplemented");
    },
    async sign() {
      throw new Error("NotImplemented");
    },
  };
  #container = new Container();

  withAccountProvider(accountProvider: ClientAccountProvider) {
    if (accountProvider !== undefined) {
      this.#accountProvider = accountProvider;
    }

    this.#container
      .bind<Get<AccountId>>("Get<AccountId>")
      .toConstantValue(this.#accountProvider.getAccountId);

    return this;
  }

  get accountProvider() {
    return this.#accountProvider;
  }

  async build({
    databaseName = "tickettoStub",
    genesisConfig = defaultMock,
  }: StubConsumerSettings = {}) {
    const database = await this.createOrOpenDatabase(
      databaseName,
      genesisConfig
    );
    this.#container
      .bind<IDBPDatabase<TickettoDBSchema>>("TickettoDB")
      .toConstantValue(database);

    const queue = new EventQueue();
    this.#container.bind(EventQueue).toConstantValue(queue);

    this.#container.bind(WebStubDirectoryCalls).toSelf();
    this.#container.bind(WebStubDirectoryStorage).toSelf();
    this.#container.bind(WebStubEventsCalls).toSelf();
    this.#container.bind(WebStubEventsStorage).toSelf();
    this.#container.bind(WebStubTicketsCalls).toSelf();
    this.#container.bind(WebStubTicketsStorage).toSelf();
    this.#container.bind(WebStubEventSubscribtion).toSelf();
  }

  async createOrOpenDatabase(
    name: string,
    genesisConfig: StubGenesisConfig
  ): Promise<IDBPDatabase<TickettoDBSchema>> {
    const database = await openDB<TickettoDBSchema>(name, undefined, {
      upgrade: (db, _, __, tx) => {
        const accountsStore = db.createObjectStore("Accounts", {
          keyPath: "id",
        });
        accountsStore.createIndex("id", "id");
        accountsStore.createIndex("display", "identity.display");
        accountsStore.createIndex("phone", "identity.phone");
        accountsStore.createIndex("email", "identity.email");

        const eventsStore = db.createObjectStore("Events", {
          keyPath: "id",
        });
        eventsStore.createIndex("id", "id");
        eventsStore.createIndex("organiser", "organiser");

        const ticketsStore = db.createObjectStore("Tickets", {
          keyPath: ["eventId", "id"],
        });
        ticketsStore.createIndex("event", "eventId");
        ticketsStore.createIndex("ownerEvent", ["owner", "eventId"]);
        ticketsStore.createIndex("owner", "owner");

        const pendingTransfersStore = db.createObjectStore("PendingTransfers", {
          keyPath: "id",
        });
        pendingTransfersStore.createIndex("sender", "sender");
        pendingTransfersStore.createIndex("beneficiary", "beneficiary");

        db.createObjectStore("Attendances", {
          keyPath: ["eventId", "id"],
        });

        db.createObjectStore("Metadata", {
          keyPath: ["type", "id"],
        });

        db.createObjectStore("Migrations", {
          keyPath: "id",
        });

        this.initializeStorage(tx, genesisConfig);
      },
    });

    return database;
  }

  initializeStorage(
    tx: IDBPTransaction<
      TickettoDBSchema,
      ArrayLike<StoreNames<TickettoDBSchema>>,
      "versionchange"
    >,
    genesisConfig: StubGenesisConfig
  ) {
    const attendancesStore = tx.objectStore("Attendances");
    const attendances = genesisConfig?.attendances ?? [];
    attendances.map((att) => attendancesStore.put(att));

    const accountsStore = tx.objectStore("Accounts");
    const accounts = genesisConfig?.accounts ?? [];
    accounts.map((account) => accountsStore.put(account));

    const eventsStore = tx.objectStore("Events");
    const events = genesisConfig?.events ?? [];
    events.map((event) => eventsStore.put(event));

    const metadataStore = tx.objectStore("Metadata");
    const metadata = genesisConfig?.metadata ?? [];
    metadata.map((meta) => metadataStore.put(meta));

    const ticketsStore = tx.objectStore("Tickets");
    const tickets = genesisConfig?.tickets ?? [];
    tickets.map((ticket) =>
      ticketsStore.put({
        ...ticket,
        id: Number(ticket.id),
      })
    );
  }

  get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>): T {
    return this.#container.get<T>(serviceIdentifier);
  }
}
