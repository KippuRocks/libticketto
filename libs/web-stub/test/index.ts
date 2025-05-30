import "./setup.ts";

import test, { describe } from "node:test";

import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.ts";
import assert from "node:assert";
import { defaultConfig } from "./defaultConfig.ts";

describe("TickettoWebStubConsumer", () => {
  test("building works", async () => {
    let client = await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .withConfig(defaultConfig)
      .build();

    assert.ok(client);
  });

  test("data persists between builds", async () => {
    let client = await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .withConfig(defaultConfig)
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
      .withConfig(defaultConfig)
      .build();

    let duaLipa = await client.tickets.query.get(1, 1);

    assert.equal(
      duaLipa!.owner,
      "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
    );
  });
});

await import("./attendances.ts");
await import("./directory.ts");
await import("./events.ts");
await import("./tickets.ts");
