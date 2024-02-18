import type { EventsModule } from "./events/index.d.ts";
import type { TicketsModule } from "./tickets/index.d.ts";

export type TickettoRuntime = {
  events: EventsModule;
  tickets: TicketsModule;
};

/**
 * A wrapping class to interact with an implementation of
 * [The Ticketto Protocol](https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md)
 */
export abstract class TickettoClient {
  constructor(private impl: TickettoRuntime) {}

  /**
   * Events module: allows managing and getting access to events
   */
  get events() {
    return {
      events: this.impl.events,
    };
  }

  /**
   * Tickets module: allows managing and getting access to tickets
   */
  get tickets() {
    return {
      events: this.impl.tickets,
    };
  }
}
