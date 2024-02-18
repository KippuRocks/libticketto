import type { EventsCalls } from "./calls.d.ts";
import type { EventsStorage } from "./storage.d.ts";

export type EventsModule = {
  calls: EventsCalls;
  query: EventsStorage;
};
