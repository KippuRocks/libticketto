import {
  AccountId,
  EventId,
  EventStatus,
  Get,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/types";
import type { TicketsCalls, TicketsStorage } from "@ticketto/protocol";
import { inject, injectable } from "inversify";
import { IDBPDatabase } from "idb";
import { TicketDB, TickettoDBSchema } from "./types.ts";
import { EventQueue } from "./subscriptions.ts";
import * as ss58 from "@subsquid/ss58-codec";

@injectable()
export class WebStubTicketsStorage implements TicketsStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    @inject("Get<AccountId>") private accountId: Get<AccountId>
  ) {}

  async #ticket({ id, ...ticket }: TicketDB) {
    const {
      id: _,
      type: __,
      ...metadata
    } = (await this.db.get("Metadata", ["ticket", ticket.eventId])) ?? {};
    const { attendances = [] } =
      (await this.db.get("Attendances", [ticket.eventId, id])) ?? {};

    return {
      id: BigInt(id),
      metadata,
      attendances: attendances.map(BigInt),
      forSale: ticket.price !== undefined,
      ...ticket,
    };
  }

  all(eventId: EventId): Promise<Ticket[]> {
    return this.db
      .getAllFromIndex("Tickets", "event", eventId)
      .then((r) => Promise.all(r.map(this.#ticket.bind(this))));
  }

  async attendances(eventId: EventId, id: TicketId): Promise<Timestamp[]> {
    const { attendances = [] } =
      (await this.db.get("Attendances", [eventId, Number(id)])) ?? {};
    return attendances.map(BigInt);
  }

  async ticketHolderOf(who: AccountId, eventId?: EventId): Promise<Ticket[]> {
    const tickets =
      eventId !== undefined
        ? await this.db.getAllFromIndex("Tickets", "ownerEvent", [who, eventId])
        : await this.db.getAllFromIndex("Tickets", "owner", who);

    return Promise.all(tickets.map(this.#ticket.bind(this)));
  }

  get(eventId: EventId, ticketId: TicketId): Promise<Ticket | undefined> {
    return this.db
      .get("Tickets", [eventId, Number(ticketId)])
      .then((t) => (t !== undefined ? this.#ticket(t) : t));
  }

  async pendingTransfersFor(who: AccountId) {
    return Promise.all(
      [
        ...(await this.db.getAllFromIndex("PendingTransfers", "sender", who)),
        ...(await this.db.getAllFromIndex(
          "PendingTransfers",
          "beneficiary",
          who
        )),
      ].map(({ id: [eventId, id] }) => this.get(eventId, BigInt(id)))
    ).then((r) => r.filter((x) => x !== undefined));
  }

  async attendanceRequest(issuer: EventId, id: TicketId): Promise<Uint8Array> {
    let ticket = await this.get(issuer, id);

    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    if (ticket.owner !== this.accountId()) {
      throw new Error("NoPermission");
    }

    let { bytes } = ss58.decode(this.accountId());
    const dv = new DataView(
      new Uint8Array([...bytes, ...new Uint8Array(12)]).buffer
    );
    dv.setUint32(32, issuer, true);
    dv.setBigUint64(36, id, true);

    return new Uint8Array(dv.buffer);
  }
}

@injectable()
export class WebStubTicketsCalls implements TicketsCalls {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    @inject("Get<AccountId>") private getAccountId: Get<AccountId>,
    private storage: WebStubTicketsStorage,
    private queue: EventQueue
  ) {}

  async issue(eventId: EventId) {
    const event = await this.db.get("Events", eventId);

    if (event === undefined) {
      throw new Error("EventNotFound");
    }

    const state = event?.state ?? EventStatus.Created;
    if (state < EventStatus.Sales || state > EventStatus.Ongoing) {
      throw new Error("InvalidState");
    }

    let id = (await this.db.countFromIndex("Tickets", "event", eventId)) + 1;
    if (event.capacity < id) {
      throw new Error("MaxCapacity");
    }

    await this.db.add("Tickets", {
      eventId,
      id,
      attendancePolicy: event?.class.attendancePolicy,
      owner: event.organiser,
      price: event.class.ticketprice,
      restrictions: event.class.ticketRestrictions,
    });

    return BigInt(id);
  }

  async initiatePendingTransfer(
    eventId: EventId,
    id: TicketId,
    beneficiary: AccountId
  ) {
    const ticket = await this.storage?.get(eventId, id);

    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    if (ticket.owner !== this.getAccountId()) {
      throw new Error("NoPermission");
    }

    if (ticket.restrictions?.cannotTransfer) {
      throw new Error("CannotTransfer");
    }

    await this.db.put("PendingTransfers", {
      id: [eventId, Number(id)],
      sender: ticket.owner,
      beneficiary,
    });
  }

  async acceptPendingTransfer(eventId: EventId, id: TicketId) {
    const who = this.getAccountId();
    const ticket = await this.db.get("Tickets", [eventId, Number(id)]);

    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    const pendingTransfer = await this.db.get("PendingTransfers", [
      eventId,
      Number(id),
    ]);

    if (pendingTransfer === undefined) {
      throw new Error("NoPendingTransfer");
    }

    if (pendingTransfer.beneficiary !== who) {
      throw new Error("NoPermission");
    }

    ticket.owner = who;
    await this.db.put("Tickets", ticket);

    this.queue.depositEvent({
      type: "TicketTransferred",
      issuer: eventId,
      id,
      newOwner: who,
    });
  }

  async cancelPendingTransfer(eventId: EventId, id: TicketId) {
    const who = this.getAccountId();

    const ticket = await this.db.get("Tickets", [eventId, Number(id)]);

    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    const pendingTransfer = await this.db.get("PendingTransfers", [
      eventId,
      Number(id),
    ]);

    if (pendingTransfer === undefined) {
      throw new Error("NoPendingTransfer");
    }

    if (who !== pendingTransfer.sender || who !== pendingTransfer.beneficiary) {
      throw new Error("NoPermission");
    }

    return this.db.delete("PendingTransfers", [eventId, Number(id)]);
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

  async submitAttendanceCall(input: Uint8Array) {
    const dv = new DataView(input.buffer);
    const eventId = dv.getUint32(32, true);
    const id = dv.getBigUint64(36, true);

    const ticket = await this.storage.get(eventId, id);
    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    let attendances = await this.storage.attendances(eventId, id);
    if (attendances.length > 0) {
      throw new Error("InvalidAttendance");
    }

    const time = Date.now();

    await this.db.put("Attendances", {
      eventId,
      id: Number(id),
      attendances: [time],
    });

    this.queue.depositEvent({
      type: "AttendanceMarked",
      issuer: eventId,
      id,
      time: BigInt(time),
      owner: ticket.owner,
    });
  }
}
