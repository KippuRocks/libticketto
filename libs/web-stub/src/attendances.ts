import { inject, injectable } from "inversify";

import {
  AttendancesCalls,
  AttendancesStorage,
  TicketsStorage,
} from "@ticketto/protocol";
import { EventId, TicketId, Timestamp } from "@ticketto/types";
import { TickettoDBSchema } from "./types.ts";
import { IDBPDatabase } from "idb";
import { EventQueue } from "./subscriptions.ts";
import { WebStubTicketsStorage } from "./tickets.ts";

@injectable()
export class WebStubAttendancesStorage implements AttendancesStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) {}

  async attendances(issuer: EventId, id: TicketId): Promise<Timestamp[]> {
    const ticketAttendances = await this.db.get("attendances", [issuer, id]);
    return ticketAttendances?.attendances ?? [];
  }
}

export type TicketAttendance = {
  issuer: EventId;
  id: TicketId;
  attendances: Timestamp[];
};

@injectable()
export class WebStubAttendancesCalls implements AttendancesCalls {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    private queue: EventQueue,
    @inject(WebStubTicketsStorage) private tickets: TicketsStorage,
    private storage: WebStubAttendancesStorage
  ) {}

  async submit(call: Uint8Array): Promise<void> {
    const decodedCall = new TextDecoder("utf-8").decode(call);
    const {
      attendance: { issuer, id },
    }: { attendance: Omit<TicketAttendance, "attendances"> } =
      JSON.parse(decodedCall);

    const ticket = await this.tickets.get(issuer, id);
    if (ticket === undefined) {
      throw new Error("TicketNotFound");
    }

    let attendances = await this.storage.attendances(issuer, id);
    if (attendances.length > 0) {
      throw new Error("InvalidAttendance");
    }

    const time = BigInt(Date.now());

    await this.db.put("attendances", { issuer, id, attendances: [time] });
    this.queue.depositEvent({
      type: "AttendanceMarked",
      issuer: issuer,
      id,
      time,
      owner: ticket.owner,
    });
  }
}
