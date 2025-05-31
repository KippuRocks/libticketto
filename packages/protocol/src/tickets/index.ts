import type { TicketsCalls } from "./calls.ts";
import type { TicketsStorage } from "./storage.ts";

export type * from "./calls.ts";
export type * from "./events.ts";
export type * from "./storage.ts";

export type TicketsModule = {
  calls: TicketsCalls;
  query: TicketsStorage;
};
