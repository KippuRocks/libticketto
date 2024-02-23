import "./setup.js";

import test, { describe } from "node:test";

import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.js";
import assert from "node:assert";

describe("TickettoWebStubConsumer", () => {
  test("building works", async () => {
    let client = await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .build();

    assert.ok(client);
  });

  test("data persists between builds", async () => {
    let client = await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .build();

    await client.tickets.calls.transfer(
      1,
      1,
      "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
    );

    assert.equal(
      (await client.tickets.query.get(1, 1))!.owner,
      "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
    );

    client = await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .build();

    let mitu = await client.tickets.query.get(1, 1);

    assert.equal(
      mitu!.owner,
      "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
    );
  });
});

await import("./events.js");
await import("./tickets.js");
