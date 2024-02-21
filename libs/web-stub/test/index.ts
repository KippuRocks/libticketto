import "./setup.js";

import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.js";
import assert from "node:assert";
import test from "node:test";

test("TickettoWebStubConsumer is a valid backend for building a TickettoClient instance", async () => {
  let client = await new TickettoClientBuilder()
    .withConsumer(TickettoWebStubConsumer)
    .build();

  assert.ok(client);
});

await import("./events.js");
await import("./tickets.js");
