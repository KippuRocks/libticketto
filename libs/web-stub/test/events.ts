import { describe, it } from "node:test";

import { StubConsumerSettings } from "../src/types.js";
import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.js";
import assert from "node:assert";
import { defaultConfig } from "./defaultConfig.js";

describe("events::storage", () => {
  async function getClient(t: { name: string }) {
    return await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .withConfig({
        ...defaultConfig,
        consumerSettings: {
          databaseName: t.name,
        } as StubConsumerSettings,
      })
      .build();
  }

  describe("#organizerFor", () => {
    it("can list events given an organizer account", async (t) => {
      const client = await getClient(t);
      const events = await client.events.query.organizerOf(
        "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw"
      );

      const [, mitu] = events;

      assert.deepEqual(mitu.name, "Mitú");
    });
  });

  describe("#ticketHolderFor", () => {
    it("can list events given an ticket holder account", async (t) => {
      const client = await getClient(t);

      const [, mitu] = await client.events.query.ticketHolderOf(
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      assert.deepEqual(mitu.name, "Mitú");
    });

    it("only includes events for which a holder has a ticket", async (t) => {
      const client = await getClient(t);

      const events = await client.events.query.ticketHolderOf(
        "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
      );

      assert(!events.find(({ id }) => id === 3));
    });
  });

  describe("#get", () => {
    it("returns undefined if key not found", async (t) => {
      const client = await getClient(t);

      assert((await client.events.query.get(5)) === undefined);
    });

    it("returns an event if key is found", async (t) => {
      const client = await getClient(t);
      const event = await client.events.query.get(2);

      assert(event?.name === "Mitú");
    });
  });
});
