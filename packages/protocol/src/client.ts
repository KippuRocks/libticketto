import { AccountId, Get } from "@ticketto/types";
import type { EventsEvent, EventsModule } from "./events/index.ts";
import type { TicketsEvent, TicketsModule } from "./tickets/index.ts";

import type { DirectoryModule } from "./directory/index.ts";
import type { EventSubscription } from "./subscription/event-subscription.ts";

export type * from "./subscription/event-subscription.ts";

export interface TickettoConsumer<Config = ClientConfig> {
  build(config?: Config): Promise<TickettoClient>;
}

/**
 * A wrapping type that can expand to either event that might be raised in the
 * protocol.
 */
export type SystemEvent = EventsEvent | TicketsEvent;

/**
 * A wrapping type to interact with an implementation of [The Ticketto Protocol][gh:ticketto]
 *
 * [gh:ticketto]: https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md
 */
export type TickettoClient = {
  readonly accountProvider: ClientAccountProvider;
  /**
   * Directory module: allows managing and fetching lists of accounts
   */
  readonly directory: DirectoryModule;

  /**
   * Events module: allows managing and getting access to events
   */
  readonly events: EventsModule;

  /**
   * Tickets module: allows managing and getting access to tickets
   * and marking the attendances of a ticket.
   */
  readonly tickets: TicketsModule;

  /**
   * System Events: An observer that allows to subscribe to some
   * events raised by the different modules.
   */
  readonly systemEvents: EventSubscription<SystemEvent>;
};

export type ClientConfig<T = unknown> = {
  accountProvider: ClientAccountProvider;
  consumerSettings?: T;
};

export interface ClientAccountProvider {
  getAccountId: Get<AccountId>;
  sign<S>(payload: S): Promise<Uint8Array>;
}
