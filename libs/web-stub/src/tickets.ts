import { AccountId, EventId, Get, Ticket, TicketId } from "@ticketto/types";
import type { TicketsCalls, TicketsStorage } from "@ticketto/protocol";
import { inject, injectable } from "inversify";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.js";
import { EventQueue } from "./subscriptions.js";

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
    return this.db.get("tickets", [eventId, ticketId]);
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
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase,
    @inject("Get<AccountId>") private getAccountId: Get<AccountId>,
    private storage: WebStubTicketsStorage,
    private queue: EventQueue
  ) {}

  issue(
    _issuer: number,
    _ticket: Omit<Ticket, "issuer" | "id">,
    _forSale?: boolean,
    _beneficiary?: AccountId
  ): Promise<number> {
    throw new Error("MethodNotImplemented.");
  }

  async transfer(
    issuer: EventId,
    id: TicketId,
    newOwner: AccountId
  ): Promise<void> {
    let ticket = await this.storage?.get(issuer, id);

    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    if (ticket.owner !== this.getAccountId()) {
      throw new Error("NotOwner");
    }

    if (ticket.restrictions?.cannotTransfer) {
      throw new Error("CannotTransfer");
    }

    ticket.owner = newOwner;
    await this.db.put("tickets", ticket);

    this.queue.depositEvent({
      type: "TicketTransferred",
      issuer,
      id,
      newOwner,
    });
  }

  async sell(_issuer: EventId, _id: TicketId): Promise<void> {
    throw new Error("MethodNotImplemented.");
  }

  withdrawSell(_issuer: EventId, _id: TicketId): Promise<void> {
    throw new Error("MethodNotImplemented.");
  }

  buy(_issuer: EventId, _id: TicketId): Promise<void> {
    throw new Error("MethodNotImplemented.");
  }
}
