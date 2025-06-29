export type * from "./directory/index.ts";
export type * from "./events/index.ts";
export type * from "./tickets/index.ts";
export type * from "./client.ts";

import type {
  ClientConfig,
  TickettoClient,
  TickettoConsumer,
} from "./client.ts";

interface ConstructorOf<Config, Consumer = TickettoConsumer<Config>> {
  new(...params: any[]): Consumer;
}

export class TickettoClientBuilder<Config = ClientConfig> {
  private consumerLike?: ConstructorOf<Config> | TickettoConsumer<Config>;
  private config?: Config;

  constructor() { }

  withConsumer(
    consumer: ConstructorOf<Config> | TickettoConsumer<Config>
  ): TickettoClientBuilder<Config> {
    this.consumerLike = consumer;
    return this;
  }

  withConfig(config: Config): TickettoClientBuilder<Config> {
    this.config = config;
    return this;
  }

  isConstructorOf(
    consumerLike: unknown
  ): consumerLike is ConstructorOf<Config> {
    return (
      typeof consumerLike === "function" &&
      consumerLike?.constructor !== undefined
    );
  }

  build(): Promise<TickettoClient> {
    if (this.consumerLike === undefined) {
      throw new Error("InvalidArgument: Missing `backend`");
    }

    let consumer: TickettoConsumer<Config>;
    if (this.isConstructorOf(this.consumerLike)) {
      let ConsumerConstructor = this.consumerLike;
      consumer = new ConsumerConstructor();
    } else {
      consumer = this.consumerLike;
    }

    return consumer.build(this.config);
  }
}
