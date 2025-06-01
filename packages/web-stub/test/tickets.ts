import { describe, it } from "node:test";

import { AccountId } from "@ticketto/types";
import { StubConsumerSettings } from "../src/types.ts";
import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.ts";
import assert from "node:assert";

describe("tickets::storage", () => {
  async function getClient(t: { name: string }, accountId?: AccountId) {
    return await new TickettoClientBuilder()
      .withConsumer(TickettoWebStubConsumer)
      .withConfig({
        accountProvider: {
          getAccountId() {
            if (accountId === undefined) {
              throw new Error("AccountIdNotProvided");
            }

            return accountId;
          },
          async sign(payload: Uint8Array) {
            return payload;
          },
        },
        consumerSettings: {
          databaseName: t.name,
        } as StubConsumerSettings,
      })
      .build();
  }

  describe("#ticketHolderOf", () => {
    it("can list tickets given a ticket holder account", async (t) => {
      const client = await getClient(t);

      let tickets = await client.tickets.query.ticketHolderOf(
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );
      assert.deepEqual(tickets.length, 3);
      const [, mitu] = tickets;
      assert.deepEqual(mitu.name, "Mitú");

      tickets = await client.tickets.query.ticketHolderOf(
        "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
      );
      assert.deepEqual(tickets.length, 3);
    });
  });

  describe("#get", () => {
    it("returns undefined if key not found", async (t) => {
      let client = await getClient(t);
      assert((await client.tickets.query.get(1, 3n)) === undefined);
    });

    it("returns an event if key is found", async (t) => {
      let client = await getClient(t);
      let ticket = await client.tickets.query.get(2, 1n);
      assert(ticket?.name === "Mitú");
    });
  });

  describe("#get", () => {
    it("fails to sign if stated accountId not owner", async (t) => {
      let client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      assert.rejects(() => client.tickets.query.attendanceRequest(1, 2n));
    });

    it("returns attendance request bytes", async (t) => {
      let client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );
      let attendanceRequest = await client.tickets.query.attendanceRequest(
        1,
        1n
      );

      assert.deepEqual(
        attendanceRequest,
        btoa(
          JSON.stringify({
            attendance: { issuer: 1, id: 1 },
          })
        )
      );
    });
  });
});
