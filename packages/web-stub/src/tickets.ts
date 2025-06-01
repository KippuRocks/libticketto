import { AccountId, EventId, Get, Ticket, TicketId } from "@ticketto/types";
import type { TicketsCalls, TicketsStorage } from "@ticketto/protocol";
import { inject, injectable } from "inversify";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.ts";
import { EventQueue } from "./subscriptions.ts";
import { buffer } from "stream/consumers";

@injectable()
export class WebStubTicketsStorage implements TicketsStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    @inject("Get<AccountId>") private accountId: Get<AccountId>
  ) {}

  async ticketHolderOf(
    ticketHolder: AccountId,
    eventId?: EventId
  ): Promise<Ticket[]> {
    const tickets =
      eventId !== undefined
        ? await this.db.getAllFromIndex("tickets", "ownerIssuer", [
            ticketHolder,
            Number(eventId),
          ])
        : await this.db.getAllFromIndex("tickets", "owner", ticketHolder);

    return tickets.map(({ id, ...ticket }) => ({
      id: BigInt(id),
      ...ticket,
    }));
  }

  get(eventId: EventId, ticketId: TicketId): Promise<Ticket | undefined> {
    return this.db.get("tickets", [eventId, Number(ticketId)]).then((t) => {
      return t !== undefined ? { ...t, id: BigInt(t.id) } : t;
    });
  }

  async attendanceRequest(issuer: EventId, id: TicketId): Promise<Uint8Array> {
    let ticket = await this.get(issuer, id);

    if (ticket === undefined) {
      throw new Error("RuntimeError: TicketNotFound");
    }

    if (ticket.owner !== this.accountId()) {
      throw new Error("RuntimeError: NotOwner");
    }

    const dv = new DataView(new ArrayBuffer(12));
    dv.setUint32(0, issuer, true);
    dv.setBigUint64(4, id, true);

    return new Uint8Array(dv.buffer);
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
    _issuer: EventId,
    _ticket: Omit<Ticket, "issuer" | "id">,
    _forSale?: boolean,
    _beneficiary?: AccountId
  ): Promise<TicketId> {
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
    await this.db.put("tickets", { ...ticket, id: Number(ticket.id) });

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
