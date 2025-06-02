import { AccountId, AttendancePolicyType, Ticket } from "@ticketto/types";
import {
  SystemEvent,
  TickettoClient,
  TickettoClientBuilder,
} from "@ticketto/protocol";
import { describe, it } from "node:test";

import { StubConsumerSettings } from "../src/types.ts";
import { TickettoWebStubConsumer } from "../src/index.ts";
import assert from "node:assert";

async function getClient(t: { name: string }, accountId?: AccountId) {
  return await new TickettoClientBuilder()
    .withConsumer(TickettoWebStubConsumer)
    .withConfig({
      accountProvider: {
        getAccountId() {
          if (accountId === undefined) {
            throw new Error("BadOrigin");
          }

          return accountId;
        },
        async sign(payload: Uint8Array) {
          if (accountId === undefined) {
            throw new Error("BadProof");
          }

          return payload;
        },
      },
      consumerSettings: {
        databaseName: t.name,
      } as StubConsumerSettings,
    })
    .build();
}

describe("tickets::storage", () => {
  describe.only("#attendances", () => {
    it("retrieves the list of all attendances", async (t) => {
      const client = await getClient(t);
      const attendances = await client.tickets.query.attendances(1, 1n);
      assert.equal(attendances.length, 0);
    });
  });

  describe("#ticketHolderOf", () => {
    it("can list tickets given a ticket holder account", async (t) => {
      const client = await getClient(t);

      let tickets = await client.tickets.query.ticketHolderOf(
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );
      assert.deepEqual(tickets.length, 3);
      const [, , dlina] = tickets;
      assert.deepEqual(dlina.attendancePolicy, {
        type: AttendancePolicyType.Unlimited,
      });

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
      assert(!ticket?.forSale);
    });
  });

  describe("#get", () => {
    it("fails to sign if stated accountId not owner", async (t) => {
      let client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      assert.rejects(client.tickets.query.attendanceRequest(1, 2n));
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
        attendanceRequest.slice(32),
        new Uint8Array([
          0x01,
          0x00,
          0x00,
          0x00, // issuer
          0x01,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00, // id
        ])
      );
    });
  });
});

describe("tickets::calls", () => {
  describe("#issue", () => {
    it("fails due to invalid state", async (t) => {
      const client = await getClient(t);

      assert.rejects(client.tickets.calls.issue(1));
      assert.rejects(client.tickets.calls.issue(4));
    });

    it("fails due to max capacity exceeded", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      const eventId = await client.events.calls.createEvent({
        name: "TTEE: The-Two-Entrances Event",
        capacity: 2n,
        class: {
          attendancePolicy: {
            type: AttendancePolicyType.Single,
          },
          ticketprice: {
            amount: 10_000000n,
            asset: {
              id: 1984,
              code: "USDt",
              decimals: 6,
            },
          },
          ticketRestrictions: {
            cannotResale: true,
            cannotTransfer: true,
          },
        },
        dates: [[BigInt(Date.now()), BigInt(Date.now()) + 86_400_000n]],
      });

      await client.events.calls.bumpState(eventId);

      await client.tickets.calls.issue(eventId);
      await client.tickets.calls.issue(eventId);
      assert.rejects(client.tickets.calls.issue(eventId));
    });

    it("successfully issues a new ticket", async (t) => {
      const client = await getClient(t);

      const eventId = 2;
      const ticketId = await client.tickets.calls.issue(eventId);

      const ticket = await client.tickets.query.get(eventId, ticketId);
      assert.deepEqual(ticket, {
        eventId: 2,
        id: 3n,
        owner: "5Fh3tNPUUKtApDZ6rJ2sDgcC5Z6pVVyAzKeE1dnqowLqWEvw",
        attendances: [],
        metadata: {
          description: "General Entrance",
          ticketArt:
            "https://wild-presenta.com/wp-content/uploads/2023/07/Copia-de-FINAL.jpg",
        },
        attendancePolicy: {
          type: AttendancePolicyType.Single,
        },
        forSale: true,
        price: {
          asset: {
            id: 57,
            code: "COP",
            decimals: 2,
          },
          amount: 600_000_00n,
        },
        restrictions: {
          cannotResale: false,
          cannotTransfer: false,
        },
      } as Partial<Ticket>);
    });
  });

  describe("#initiatePendingTransfer", () => {
    it("fails if the ticket does not exist", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      assert.rejects(
        client.tickets.calls.initiatePendingTransfer(
          4,
          2n,
          "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
        ),
        { message: "TicketNotFound" }
      );
    });

    it("fails if the signer has no permissions to initiate the transfer", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      assert.rejects(
        client.tickets.calls.initiatePendingTransfer(
          4,
          1n,
          "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
        ),
        { message: "NoPermission" }
      );
    });

    it("fails if the ticket cannot be transferred", async (t) => {
      const client = await getClient(
        t,
        "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
      );

      assert.rejects(
        client.tickets.calls.initiatePendingTransfer(
          4,
          1n,
          "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
        ),
        { message: "CannotTransfer" }
      );
    });

    it("successfully initiates a pending transfer", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      await client.tickets.calls.initiatePendingTransfer(
        1,
        1n,
        "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
      );

      const [ticketA] = await client.tickets.query.pendingTransfersFor(
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );
      const [ticketB] = await client.tickets.query.pendingTransfersFor(
        "5HVoCpiwRWMZCmM8ituz46JVGAzvAjqsHrGkdhqrDUD4NW6o"
      );

      assert.deepEqual(ticketA, ticketB);
    });
  });

  describe("#submitAttendanceCall", () => {
    function createCall(client: TickettoClient) {
      return client.tickets.query.attendanceRequest(1, 1n);
    }

    it("successfully registers the attendance", async (t) => {
      const client = await getClient(
        t,
        "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG"
      );

      let capturedEvent: SystemEvent | undefined;
      client.systemEvents.on((event) => (capturedEvent = event));

      const call = await createCall(client);
      await client.tickets.calls.submitAttendanceCall(call);

      const atttendances = await client.tickets.query.attendances(1, 1n);
      assert.equal(atttendances.length, 1);

      assert.deepEqual(capturedEvent, {
        type: "AttendanceMarked",
        issuer: 1,
        id: 1n,
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

      await client.tickets.calls.submitAttendanceCall(call);
      assert.rejects(client.tickets.calls.submitAttendanceCall(call));
    });
  });
});
