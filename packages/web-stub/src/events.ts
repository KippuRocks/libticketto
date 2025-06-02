import { AccountId, Event, EventId, EventStatus, Get } from "@ticketto/types";

import type { EventsCalls } from "@ticketto/protocol";
import type { EventsStorage } from "@ticketto/protocol";
import { injectable, inject } from "inversify";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.ts";
import { EventQueue } from "./subscriptions.ts";

@injectable()
export class WebStubEventsStorage implements EventsStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) {}

  #event(event: undefined): Promise<undefined>;
  #event(event: Event): Promise<Event>;
  async #event(event?: Event): Promise<Event | undefined> {
    if (event === undefined) {
      return undefined;
    }

    const [date] = event.dates ?? [];
    const {
      type: _,
      id: __,
      ...metadata
    } = (await this.db.get("Metadata", ["event", event.id])) ?? {};
    return { ...event, date, metadata };
  }

  async all(): Promise<Event[]> {
    const events = await this.db.getAll("Events");
    return await Promise.all(events.map(this.#event.bind(this)));
  }

  async organizerOf(who: AccountId): Promise<Event[]> {
    const events = await this.db.getAllFromIndex("Events", "organiser", who);
    return await Promise.all(events.map(this.#event.bind(this)));
  }

  async ticketHolderOf(who: AccountId): Promise<Event[]> {
    const eventsIds = await this.db
      .getAllKeysFromIndex("Tickets", "owner", who)
      .then((ids) => ids.map(([eventId, _]) => eventId))
      .then((ids) => [...new Set(ids)])
      .then((ids) => ids.filter((id) => id !== undefined));

    const events = await Promise.all(eventsIds.map(this.get.bind(this)));

    return events.filter((e) => e !== undefined);
  }

  async get(eventId: EventId) {
    const event = await this.db.get("Events", eventId);
    return event !== undefined ? this.#event(event) : event;
  }
}

@injectable()
export class WebStubEventsCalls implements EventsCalls {
  @inject(WebStubEventsStorage) private storage?: WebStubEventsStorage;

  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    @inject("Get<AccountId>") private readonly getAccountId: Get<AccountId>,
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
    event: Omit<Event, "id" | "date" | "status">
  ): Promise<EventId> {
    let id = (await this.db.count("Events")) + 1;

    await this.db.put("Events", {
      id,
      ...event,
      organiser: this.getAccountId(),
      state: EventStatus.Created,
    });

    this.queue.depositEvent({
      type: "EventCreated",
      id,
      owner: event.organiser,
    });

    return id;
  }

  async update(id: number, update: Partial<Omit<Event, "id">>) {
    let event = await this.getEvent(id);

    await this.db.put("Events", {
      ...event,
      ...update,
    });

    this.queue.depositEvent({
      type: "EventUpdated",
      id,
    });
  }

  async bumpState(id: EventId) {
    const event = await this.db.get("Events", id);

    if (event === undefined) {
      throw new Error("EventNotFound");
    }

    let newState: EventStatus;
    switch (event.state) {
      case EventStatus.Created:
        if (this.getAccountId() !== event.organiser) {
          // Only the organiser can bump into sales.
          throw new Error("NoPermission");
        }
        newState = EventStatus.Sales;
        break;
      case EventStatus.Sales:
        if (
          BigInt(Date.now()) <
          (event.dates?.at(0)?.[0] ?? BigInt(Date.now() + 1))
        ) {
          // The event must have begun to go into the next state.
          throw new Error("InvalidState");
        }
        newState = EventStatus.Ongoing;
        break;
      case EventStatus.Ongoing:
        if (
          BigInt(Date.now()) <
          (event.dates?.at(-1)?.[1] ?? BigInt(Date.now() + 1))
        ) {
          // The event must have ended to go into the next state.
          throw new Error("InvalidState");
        }
        newState = EventStatus.Ongoing;
        break;
      case EventStatus.Finished:
        // The event is already finished
        throw new Error("InvalidState");
    }

    await this.db.put("Events", { ...event, state: newState });
  }

  async transferOrganiser(id: number, newOrganiser: AccountId) {
    let event = await this.getEvent(id);

    if (this.getAccountId() !== event.organiser) {
      throw new Error("NoPermission");
    }

    event.organiser = newOrganiser;

    await this.db.put("Events", event);

    this.queue.depositEvent({
      type: "EventOwnershipTransferred",
      id,
      newOwner: newOrganiser,
    });
  }
}
