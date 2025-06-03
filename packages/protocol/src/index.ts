export type * from "./directory/index.ts";
export type * from "./events/index.ts";
export type * from "./tickets/index.ts";
export type * from "./client.ts";

import type {
  ClientConfig,
  TickettoClient,
  TickettoConsumer,
} from "./client.ts";

interface ConstructorOf<S, Config, Consumer = TickettoConsumer<S, Config>> {
  new (...params: any[]): Consumer;
}

export class TickettoClientBuilder<S = Uint8Array, Config = ClientConfig<S>> {
  private consumerLike?: ConstructorOf<S, Config> | TickettoConsumer<S, Config>;
  private config?: Config;

  constructor() {}

  withConsumer(
    consumer: ConstructorOf<S, Config> | TickettoConsumer<S, Config>
  ): TickettoClientBuilder<S, Config> {
    this.consumerLike = consumer;
    return this;
  }

  withConfig(config: Config): TickettoClientBuilder<S, Config> {
    this.config = config;
    return this;
  }

  isConstructorOf(
    consumerLike: unknown
  ): consumerLike is ConstructorOf<S, Config> {
    return (
      typeof consumerLike === "function" &&
      consumerLike?.constructor !== undefined
    );
  }

  build(): Promise<TickettoClient<S>> {
    if (this.consumerLike === undefined) {
      throw new Error("InvalidArgument: Missing `backend`");
    }

    let consumer: TickettoConsumer<S, Config>;
    if (this.isConstructorOf(this.consumerLike)) {
      let ConsumerConstructor = this.consumerLike;
      consumer = new ConsumerConstructor();
    } else {
      consumer = this.consumerLike;
    }

    return consumer.build(this.config);
  }
}
