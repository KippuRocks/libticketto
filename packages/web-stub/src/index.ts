import type { ClientConfig, TickettoConsumer } from "@ticketto/protocol";
import { WebStubDirectoryCalls, WebStubDirectoryStorage } from "./directory.ts";
import { WebStubEventsCalls, WebStubEventsStorage } from "./events.ts";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "./tickets.ts";

import { Stub } from "./stub/index.ts";
import { StubConsumerSettings } from "./types.ts";
import { WebStubEventSubscribtion } from "./subscriptions.ts";
import { injectable } from "inversify";

@injectable()
export class TickettoWebStubConsumer implements TickettoConsumer<Uint8Array> {
  constructor(private stub: Stub = new Stub()) {}

  async build(config: ClientConfig<Uint8Array>) {
    await this.stub
      .withAccountProvider(config.accountProvider)
      .build(config.consumerSettings as StubConsumerSettings | undefined);

    return {
      accountProvider: this.stub.accountProvider,
      directory: {
        calls: this.stub.get(WebStubDirectoryCalls),
        query: this.stub.get(WebStubDirectoryStorage),
      },
      events: {
        calls: this.stub.get(WebStubEventsCalls),
        query: this.stub.get(WebStubEventsStorage),
      },
      tickets: {
        calls: this.stub.get(WebStubTicketsCalls),
        query: this.stub.get(WebStubTicketsStorage),
      },
      systemEvents: this.stub.get(WebStubEventSubscribtion),
    };
  }
}
