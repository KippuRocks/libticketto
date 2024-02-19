export type * from "./events/index.js";
export type * from "./tickets/index.js";
export type * from "./client.js";

import type { TickettoClient, TickettoRuntime } from "./client.js";

interface ConstructorOf<Config, Runtime = TickettoRuntime<Config>> {
  new (config?: Config): Runtime;
}

export class TickettoClientBuilder<Config> {
  private backendConstructor?: ConstructorOf<Config>;
  private config?: Config;

  constructor() {}

  withBackend(
    constructor: ConstructorOf<Config>
  ): TickettoClientBuilder<Config> {
    this.backendConstructor = constructor;
    return this;
  }

  withConfig(config: Config): TickettoClientBuilder<Config> {
    this.config = config;
    return this;
  }

  build(): Promise<TickettoClient> {
    let BackendConstructor = this.backendConstructor;
    if (!BackendConstructor) {
      throw new Error("InvalidArgument: Missing `backend`");
    }

    return new BackendConstructor().build(this.config);
  }
}
