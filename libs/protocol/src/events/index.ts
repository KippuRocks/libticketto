import type { EventsCalls } from "./calls.js";
import type { EventsStorage } from "./storage.js";

export type * from "./calls.js";
export type * from "./events.js";
export type * from "./storage.js";

export type EventsModule = {
  calls: EventsCalls;
  query: EventsStorage;
};
