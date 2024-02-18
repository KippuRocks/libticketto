import type { TicketsCalls } from "./calls.d.ts";
import type { TicketsStorage } from "./storage.d.ts";

export type TicketsModule = {
  calls: TicketsCalls;
  query: TicketsStorage;
};
