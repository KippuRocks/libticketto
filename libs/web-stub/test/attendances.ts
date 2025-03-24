import {
  SystemEvent,
  TickettoClient,
  TickettoClientBuilder,
} from "@ticketto/protocol";
import { describe, it } from "node:test";

import { AccountId } from "@ticketto/types";
import { StubConsumerSettings } from "../src/types.js";
import { TickettoWebStubConsumer } from "../src/index.js";
import assert from "node:assert";

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
        async sign(payload) {
          return payload;
        },
      },
      consumerSettings: {
        databaseName: t.name,
      } as StubConsumerSettings,
    })
    .build();
}

describe("attendances::storage", () => {
  describe("#attendances", () => {
    it("retrieves the list of all attendances", async (t) => {
      const client = await getClient(t);
      const attendances = await client.attendances.query.attendances(1, 1);
      assert.equal(attendances.length, 0);
    });
  });
});

describe("attendances::calls", () => {
  describe("#submit", () => {
    function createCall(client: TickettoClient) {
      return client.tickets.query.attendanceRequest(1, 1);
    }

    it("successfully registers the attendance", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      let capturedEvent: SystemEvent | undefined;
      client.systemEvents.on((event) => (capturedEvent = event));

      const call = await createCall(client);
      await client.attendances.calls.submit(call);

      const atttendances = await client.attendances.query.attendances(1, 1);
      assert.equal(atttendances.length, 1);

      assert.deepEqual(capturedEvent, {
        type: "AttendanceMarked",
        issuer: 1,
        id: 1,
        owner: "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
        time: atttendances[0],
      } as SystemEvent);
    });

    it("fails to register an attendance", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );
      const call = await createCall(client);

      await client.attendances.calls.submit(call);
      assert.rejects(() => client.attendances.calls.submit(call));
    });
  });
});
