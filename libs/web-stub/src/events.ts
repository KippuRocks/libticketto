import { AccountId, Event, EventId, Ticket } from "@ticketto/types";

import type { EventsCalls } from "@ticketto/protocol";
import type { EventsStorage } from "@ticketto/protocol";
import { injectable, inject } from "inversify";
import { IDBPDatabase, IDBPIndex } from "idb";
import { TickettoDBSchema } from "./types.js";

@injectable()
export class WebStubEventsStorage implements EventsStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) {}

  async organizerOf(accountId: AccountId): Promise<Event[]> {
    return this.db.getAllFromIndex("events", "owner", accountId);
  }

  async ticketHolderOf(ticketHolder: AccountId): Promise<Event[]> {
    const eventsIds = await this.db
      .getAllKeysFromIndex("tickets", "owner", ticketHolder)
      .then((ids) => ids.map(([eventId, _]) => eventId))
      .then((eventIds) => [...new Set(eventIds)]);

    return Promise.all(
      eventsIds.map((eventId) => this.db.get("events", eventId))
    ).then((list) => list.filter((ev) => ev !== undefined) as Event[]);
  }

  async get(eventId: EventId): Promise<Event | undefined> {
    return this.db.get("events", eventId);
  }
}

@injectable()
export class WebStubEventsCalls implements EventsCalls {
  @inject(WebStubEventsStorage) private storage?: WebStubEventsStorage;

  createEvent(owner: AccountId, event: Omit<Event, "id">): Promise<number> {
    throw new Error("Method not implemented.");
  }
  update(id: number, event: Partial<Omit<Event, "id">>): Promise<void> {
    throw new Error("Method not implemented.");
  }
  transferOwner(id: number, newOwner: Omit<Event, "id">): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
