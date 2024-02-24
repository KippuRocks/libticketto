import { AccountId, Get } from "@ticketto/types";

import type { EventsModule } from "./events/index.js";
import type { TicketsModule } from "./tickets/index.js";

export interface TickettoConsumer<Config = ClientConfig> {
  build(config?: Config): Promise<TickettoClient>;
}

/**
 * A wrapping type to interact with an implementation of [The Ticketto Protocol][gh:ticketto]
 *
 * [gh:ticketto]: https://github.com/kippurocks/ticketto/blob/main/PROTOCOL.md
 */
export type TickettoClient = {
  /**
   * Account provider: allows handling access to the client's account provider
   */
  readonly acccountProvider: ClientAccountProvider;
  /**
   * Events module: allows managing and getting access to events
   */
  readonly events: EventsModule;

  /**
   * Tickets module: allows managing and getting access to tickets
   */
  readonly tickets: TicketsModule;
};

export type ClientConfig = {
  accountProvider?: ClientAccountProvider;
  consumerSettings?: unknown;
};

export interface ClientAccountProvider {
  getAccountId?: Get<AccountId>;
  sign(payload: Uint8Array): Uint8Array;
}
