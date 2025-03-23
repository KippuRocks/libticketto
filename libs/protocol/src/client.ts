import { AccountId, Get } from "@ticketto/types";
import type {
  AttandancesEvent,
  AttendancesModule,
} from "./attendances/index.js";
import type { EventsEvent, EventsModule } from "./events/index.js";
import type { TicketsEvent, TicketsModule } from "./tickets/index.js";

import type { DirectoryModule } from "./directory/index.js";
import type { EventSubscription } from "./subscription/event-subscription.js";

export type * from "./subscription/event-subscription.js";

export interface TickettoConsumer<Config = ClientConfig> {
  build(config?: Config): Promise<TickettoClient>;
}

/**
 * A wrapping type that can expand to either event that might be raised in the
 * protocol.
 */
export type SystemEvent = AttandancesEvent | EventsEvent | TicketsEvent;

/**
 * A wrapping type to interact with an implementation of [The Ticketto Protocol][gh:ticketto]
 *
 * [gh:ticketto]: https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md
 */
export type TickettoClient = {
  /**
   * Account provider: allows handling access to the client's account provider
   */
  readonly accountProvider: ClientAccountProvider;

  /**
   * Attendances module: registers the atttendances to an event using a ticket.
   */
  readonly attendances: AttendancesModule;

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
   */
  readonly tickets: TicketsModule;

  /**
   * System Events: An observer that allows to subscribe to some
   * events raised by the different modules.
   */
  readonly systemEvents: EventSubscription<SystemEvent>;
};

export type ClientConfig = {
  accountProvider: ClientAccountProvider;
  consumerSettings?: unknown;
};

export interface ClientAccountProvider {
  getAccountId: Get<AccountId>;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}
