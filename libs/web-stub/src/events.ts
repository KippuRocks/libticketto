import { AccountId, Event, EventId } from "@ticketto/types";

import type { EventsCalls } from "@ticketto/protocol";
import type { EventsStorage } from "@ticketto/protocol";
import { injectable, inject } from "inversify";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.js";
import { EventQueue } from "./subscriptions.js";

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

  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    private queue: EventQueue
  ) {}

  private async getEvent(id: EventId) {
    const event = await this.storage?.get(id);

    if (event === undefined) {
      throw new Error("EventNotFound");
    }

    return event;
  }

  async createEvent(
    owner: AccountId,
    event: Omit<Event, "id">
  ): Promise<EventId> {
    let id = (await this.db.count("events")) + 1;

    await this.db.put("events", {
      id,
      ...event,
      owner,
    });

    this.queue.depositEvent({
      type: "EventCreated",
      id,
      owner: event.owner,
    });

    return id;
  }

  async update(id: number, update: Partial<Omit<Event, "id">>) {
    let event = await this.getEvent(id);

    await this.db.put("events", {
      ...event,
      ...update,
    });

    this.queue.depositEvent({
      type: "EventUpdated",
      id,
    });
  }

  async transferOwner(id: number, newOwner: AccountId) {
    let event = await this.getEvent(id);
    event.owner = newOwner;

    await this.db.put("events", event);

    this.queue.depositEvent({
      type: "EventOwnershipTransferred",
      id,
      newOwner,
    });
  }
}
