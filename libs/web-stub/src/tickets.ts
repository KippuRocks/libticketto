import { AccountId, EventId, Get, Ticket, TicketId } from "@ticketto/types";
import type { TicketsCalls, TicketsStorage } from "@ticketto/protocol";
import { inject, injectable } from "inversify";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.js";

@injectable()
export class WebStubTicketsStorage implements TicketsStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    @inject("Get<AccountId>") private accountId: Get<AccountId>
  ) {}

  ticketHolderOf(
    ticketHolder: AccountId,
    eventId?: EventId
  ): Promise<Ticket[]> {
    return eventId !== undefined
      ? this.db.getAllFromIndex("tickets", "ownerIssuer", [
          ticketHolder,
          eventId,
        ])
      : this.db.getAllFromIndex("tickets", "owner", ticketHolder);
  }

  get(eventId: EventId, ticketId: TicketId): Promise<Ticket | undefined> {
    return this.db.getFromIndex("tickets", "issuerId", [eventId, ticketId]);
  }

  async attendanceRequest(issuer: EventId, id: TicketId): Promise<Uint8Array> {
    let ticket = await this.get(issuer, id);

    if (ticket === undefined) {
      throw new Error("RuntimeError: TicketNotFound");
    }

    if (ticket.owner !== this.accountId()) {
      throw new Error("RuntimeError: NotOwner");
    }

    return new Uint8Array(
      Buffer.from(
        JSON.stringify({
          attendance: { issuer, id },
        })
      )
    );
  }
}

@injectable()
export class WebStubTicketsCalls implements TicketsCalls {
  @inject("Get<AccountId>") private accountId?: AccountId;
  @inject(WebStubTicketsStorage) private storage?: WebStubTicketsStorage;

  issue(
    issuer: number,
    ticket: Omit<Ticket, "issuer" | "id">,
    forSale?: boolean,
    beneficiary?: AccountId
  ): Promise<number> {
    throw new Error("Method not implemented.");
  }

  async transfer(
    issuer: EventId,
    id: TicketId,
    receiver: AccountId
  ): Promise<void> {
    let ticket = await this.storage?.get(issuer, id);

    if (ticket === undefined) {
      throw new Error("RuntimeError: TicketNotFound");
    }

    if (ticket.owner !== this.accountId) {
      throw new Error("RuntimeError: NotOwner");
    }

    if (ticket.restrictions?.cannotTransfer) {
      throw new Error("RuntimeError: CannotTransfer");
    }

    ticket.owner = receiver;
  }

  async sell(issuer: EventId, id: TicketId): Promise<void> {
    throw new Error("Method not implemented.");
  }

  withdrawSell(issuer: EventId, id: TicketId): Promise<void> {
    throw new Error("Method not implemented.");
  }

  buy(issuer: EventId, id: TicketId): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
