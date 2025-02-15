import { inject, injectable } from "inversify";

import { AttendancesCalls, AttendancesStorage } from "@ticketto/protocol";
import { EventId, TicketId, Timestamp } from "@ticketto/types";
import { TickettoDBSchema } from "./types.js";
import { IDBPDatabase } from "idb";

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
    private storage: WebStubAttendancesStorage
  ) {}

  async submit(call: Uint8Array): Promise<void> {
    const decodedCall = new TextDecoder("utf-8").decode(call);
    const {
      attendance: { issuer, id },
    }: { attendance: Omit<TicketAttendance, "attendances"> } =
      JSON.parse(decodedCall);

    let attendances = await this.storage.attendances(issuer, id);
    if (attendances.length > 0) {
      throw new Error("InvalidTicket");
    }

    await this.db.put("attendances", { issuer, id, attendances: [Date.now()] });
  }
}
