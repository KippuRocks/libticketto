import type {
  ClientConfig,
  TickettoClient,
  TickettoConsumer,
} from "@ticketto/protocol";
import { WebStubEventsCalls, WebStubEventsStorage } from "./events.js";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "./tickets.js";

import { Stub } from "./stub/index.js";
import { StubConsumerSettings } from "./types.js";
import { injectable } from "inversify";

@injectable()
export class TickettoWebStubConsumer implements TickettoConsumer {
  constructor(private stub: Stub = new Stub()) {}

  async build(config?: ClientConfig): Promise<TickettoClient> {
    this.stub.accountProvider = config?.accountProvider;
    await this.stub.build(config?.consumerSettings as StubConsumerSettings);

    return {
      events: {
        calls: this.stub.get(WebStubEventsCalls),
        query: this.stub.get(WebStubEventsStorage),
      },
      tickets: {
        calls: this.stub.get(WebStubTicketsCalls),
        query: this.stub.get(WebStubTicketsStorage),
      },
    };
  }
}
