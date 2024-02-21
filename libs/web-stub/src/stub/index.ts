import { AccountId, Event, Get } from "@ticketto/types";
import { Container, interfaces } from "inversify";
import { WebStubEventsCalls, WebStubEventsStorage } from "../events.js";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "../tickets.js";

import { ClientAccountProvider } from "@ticketto/protocol";
import { openDB, type IDBPDatabase } from "idb";
import {
  StubConsumerSettings,
  TickettoDBSchema,
  StubGenesisConfig,
} from "../types.js";
import defaultMock from "./default-mock.js";

export class Stub {
  #container = new Container();

  set accountProvider(accountProvider: ClientAccountProvider | undefined) {
    this.#container
      .bind<Get<AccountId>>("Get<AccountId>")
      .toConstantValue(
        accountProvider?.getAccountId ??
          (() => "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw")
      );
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
      upgrade(db) {
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
          keyPath: ["owner", "issuer", "id"],
        });
        ticketsStore.createIndex("owner", "owner");
        ticketsStore.createIndex("ownerIssuer", ["owner", "issuer"]);
        ticketsStore.createIndex("issuerId", ["issuer", "id"]);
        ticketsStore.createIndex("id", ["owner", "issuer", "id"]);
      },
    });

    await this.initializeStorage(database, genesisConfig);

    return database;
  }

  async initializeStorage(
    database: IDBPDatabase<TickettoDBSchema>,
    genesisConfig: StubGenesisConfig
  ) {
    const accountsTx = database.transaction("accounts", "readwrite");
    await Promise.all([
      ...(genesisConfig?.accounts ?? []).map((account) =>
        accountsTx.store.put(account)
      ),
      accountsTx.done,
    ]);

    const eventsTx = database.transaction("events", "readwrite");
    await Promise.all([
      ...(genesisConfig?.events ?? []).map((event) =>
        eventsTx.store.put(event)
      ),
      eventsTx.done,
    ]);

    const ticketsTx = database.transaction("tickets", "readwrite");
    await Promise.all([
      ...(genesisConfig?.tickets ?? []).map((ticket) =>
        ticketsTx.store.put(ticket)
      ),
      ticketsTx.done,
    ]);
  }

  get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>): T {
    return this.#container.get<T>(serviceIdentifier);
  }
}
