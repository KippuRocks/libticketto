import { AccountId, Event, Get } from "@ticketto/types";
import { Container, interfaces } from "inversify";
import { WebStubEventsCalls, WebStubEventsStorage } from "../events.js";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "../tickets.js";

import { ClientAccountProvider } from "@ticketto/protocol";
import { IDBPTransaction, StoreNames, openDB, type IDBPDatabase } from "idb";
import {
  StubConsumerSettings,
  TickettoDBSchema,
  StubGenesisConfig,
} from "../types.js";
import defaultMock from "./default-mock.js";

export class Stub {
  #accountProvider: ClientAccountProvider = {
    getAccountId() {
      return "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG";
    },
    sign(payload) {
      return payload;
    },
  };
  #container = new Container();

  set accountProvider(accountProvider: ClientAccountProvider | undefined) {
    this.#container
      .bind<Get<AccountId>>("Get<AccountId>")
      .toConstantValue(
        accountProvider?.getAccountId ??
          (() => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG")
      );
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

    this.#container.bind(WebStubEventsCalls).to(WebStubEventsCalls);
    this.#container.bind(WebStubEventsStorage).to(WebStubEventsStorage);
    this.#container.bind(WebStubTicketsCalls).to(WebStubTicketsCalls);
    this.#container.bind(WebStubTicketsStorage).to(WebStubTicketsStorage);
  }

  async createOrOpenDatabase(
    name: string,
    genesisConfig: StubGenesisConfig
  ): Promise<IDBPDatabase<TickettoDBSchema>> {
    const database = await openDB<TickettoDBSchema>(name, undefined, {
      upgrade: (db, _, __, tx) => {
        const accountsStore = db.createObjectStore("accounts", {
          keyPath: "id",
        });
        accountsStore.createIndex("id", "id");

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
