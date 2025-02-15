import { inject, injectable } from "inversify";

import { AttendancesCalls, AttendancesStorage } from "@ticketto/protocol";
import { EventId, TicketId, Timestamp } from "@ticketto/types";
import { TickettoDBSchema } from "./types.js";
import { IDBPDatabase } from "idb";

@injectable()
export class WebStubAttendancesStorage implements AttendancesStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) { }

  async attendances(id: EventId, ticketId: TicketId): Promise<Timestamp[]> {
    return (await this.db.get("attendances", [id, ticketId]) ?? []);
  }
}

@injectable()
export class WebStubAttendancesCalls implements AttendancesCalls {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>,
    private storage: WebStubAttendancesStorage
  ) { }

  async create(eventId: EventId, ticketId: TicketId): Promise<string> {
    return JSON.stringify({
      eventId, ticketId
    });
  }

  async submit(call: string): Promise<void> {
    const { eventId, ticketId }: { eventId: EventId, ticketId: TicketId } = JSON.parse(call);
    let attendances = await this.storage.attendances(eventId, ticketId);
    if (attendances.length > 0) {
      throw new Error("InvalidTicket");
    }

    await this.db.put("attendances", [Date.now()], [eventId, ticketId]);
  }

}
