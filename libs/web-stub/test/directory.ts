import { describe, it } from "node:test";

import { AccountId } from "@ticketto/types";
import { StubConsumerSettings } from "../src/types.ts";
import { TickettoClientBuilder } from "@ticketto/protocol";
import { TickettoWebStubConsumer } from "../src/index.ts";
import assert from "node:assert";

describe("accounts::storage", () => {
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

  describe("#all", () => {
    it("retrieves the list of all accounts", async (t) => {
      let client = await getClient(t);

      assert.equal((await client.directory.query.all()).length, 2);
    });
  });

  describe("#indexByDisplay", () => {
    it("retrieves a list indexed by first letter of account's display", async (t) => {
      let client = await getClient(t);

      assert.equal(
        (await client.directory.query.indexByDisplay("a")).length,
        1
      );
      assert.equal(
        (await client.directory.query.indexByDisplay("b")).length,
        1
      );
    });
  });

  describe("#indexByEmail", () => {
    it("retrieves a list indexed by first letter of account's email", async (t) => {
      let client = await getClient(t);

      assert.equal((await client.directory.query.indexByEmail("a")).length, 1);
      assert.equal((await client.directory.query.indexByEmail("b")).length, 1);
    });
  });

  describe("#indexByPhone", () => {
    it("retrieves a list indexed by first digot of account's phone", async (t) => {
      let client = await getClient(t);

      assert.equal(
        (await client.directory.query.indexByPhone("1.41")).length,
        2
      );
      assert.equal(
        (await client.directory.query.indexByPhone("1.415")).length,
        1
      );
      assert.equal(
        (await client.directory.query.indexByPhone("1.416")).length,
        1
      );
    });
  });
});
