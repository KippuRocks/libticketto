import type { EventsModule } from "./events/index.js";
import type { TicketsModule } from "./tickets/index.js";

export interface TickettoRuntime<Config> {
  build(config?: Config): Promise<TickettoClient>;
}

/**
 * A wrapping type to interact with an implementation of [The Ticketto Protocol][gh:ticketto]
 *
 * [gh:ticketto]: https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md
 */
export type TickettoClient = {
  /**
   * Events module: allows managing and getting access to events
   */
  readonly events: EventsModule;

  /**
   * Tickets module: allows managing and getting access to tickets
   */
  readonly tickets: TicketsModule;
};
