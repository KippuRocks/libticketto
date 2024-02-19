import type { TicketsCalls } from "./calls.js";
import type { TicketsStorage } from "./storage.js";

export type * from "./calls.js";
export type * from "./storage.js";

export type TicketsModule = {
  calls: TicketsCalls;
  query: TicketsStorage;
};
