import type { EventsCalls } from "./calls.ts";
import type { EventsStorage } from "./storage.ts";

export type * from "./calls.ts";
export type * from "./events.ts";
export type * from "./storage.ts";

export type EventsModule = {
  calls: EventsCalls;
  query: EventsStorage;
};
