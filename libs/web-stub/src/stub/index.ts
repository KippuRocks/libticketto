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
import {
  WebStubAttendancesCalls,
  WebStubAttendancesStorage,
} from "../attendances.ts";
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
    databaseName = "kippu",
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

    this.#container.bind(WebStubAttendancesCalls).toSelf();
    this.#container.bind(WebStubAttendancesStorage).toSelf();
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
        db.createObjectStore("attendances", {
          keyPath: ["issuer", "id"],
        });

        const accountsStore = db.createObjectStore("accounts", {
          keyPath: "id",
        });
        accountsStore.createIndex("id", "id");
        accountsStore.createIndex("display", "identity.display");
        accountsStore.createIndex("phone", "identity.phone");
        accountsStore.createIndex("email", "identity.email");

        const eventsStore = db.createObjectStore("events", {
          keyPath: "id",
        });
        eventsStore.createIndex("id", "id");
        eventsStore.createIndex("owner", "owner");

        const ticketsStore = db.createObjectStore("tickets", {
          keyPath: ["issuer", "id"],
        });
        ticketsStore.createIndex("ownerIssuer", ["owner", "issuer"]);
        ticketsStore.createIndex("owner", "owner");

        db.createObjectStore("migrations", {
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
    const attendancesStore = tx.objectStore("attendances");
    const attendances = genesisConfig?.attendances ?? [];
    attendances.map((ticketAttendances) =>
      attendancesStore.put(ticketAttendances)
    );

    const accountsStore = tx.objectStore("accounts");
    const accounts = genesisConfig?.accounts ?? [];
    accounts.map((account) => accountsStore.put(account));

    const eventsStore = tx.objectStore("events");
    const events = genesisConfig?.events ?? [];
    events.map((event) => eventsStore.put(event));

    const ticketsStore = tx.objectStore("tickets");
    const tickets = genesisConfig?.tickets ?? [];
    tickets.map((ticket) => ticketsStore.put(ticket));
  }

  get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>): T {
    return this.#container.get<T>(serviceIdentifier);
  }
}
