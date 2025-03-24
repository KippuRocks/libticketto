import type {
  ClientConfig,
  TickettoClient,
  TickettoConsumer,
} from "@ticketto/protocol";
import {
  WebStubAttendancesCalls,
  WebStubAttendancesStorage,
} from "./attendances.js";
import { WebStubDirectoryCalls, WebStubDirectoryStorage } from "./directory.js";
import { WebStubEventsCalls, WebStubEventsStorage } from "./events.js";
import { WebStubTicketsCalls, WebStubTicketsStorage } from "./tickets.js";

import { Stub } from "./stub/index.js";
import { StubConsumerSettings } from "./types.js";
import { WebStubEventSubscribtion } from "./subscriptions.js";
import { injectable } from "inversify";

@injectable()
export class TickettoWebStubConsumer implements TickettoConsumer {
  constructor(private stub: Stub = new Stub()) {}

  async build(config: ClientConfig): Promise<TickettoClient> {
    await this.stub
      .withAccountProvider(config.accountProvider)
      .build(config.consumerSettings as StubConsumerSettings | undefined);

    return {
      accountProvider: this.stub.accountProvider!,
      attendances: {
        calls: this.stub.get(WebStubAttendancesCalls),
        query: this.stub.get(WebStubAttendancesStorage),
      },
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
