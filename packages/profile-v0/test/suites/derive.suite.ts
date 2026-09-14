// T-003-02 — identifier derivation (REQ-ID-1, REQ-EV-9, REQ-MG-2, REQ-MG-6).
// Known answers were computed independently, with Python's hashlib.

import type { AccountId, Discriminator, EventId, Position, ZoneId } from "@ticketto/sdk";
import { fromHex, toHex } from "../../src/bytes.js";
import {
  deviceId,
  eventId,
  hashedUserId,
  holderAccountFromHashedUserId,
  holderAccountId,
  p256AccountId,
  ticketId,
} from "../../src/derive.js";
import { assert, assertEqual, assertThrows, type Suite } from "../harness.js";
import { Random } from "../random.js";

const USER_ID = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const CREATOR = "11".repeat(32) as AccountId;
const ZONE = "22".repeat(32) as ZoneId;
const EVENT = "98ceea13f68bc1372cf7c6893a51ed4080b11a2d9af5e780509bd808844645ab" as EventId;

export const deriveSuite: Suite = ({ describe, it }) => {
  describe("T-003-02 derivation, known answers", () => {
    it("hashedUserId is SHA-256 of the hex string", () => {
      assertEqual(
        toHex(hashedUserId(USER_ID)),
        "6c86c6aac5fb24bcf5d9939cb7d7d5645ce39418f449e03b262dd4fa14b4b92b",
      );
    });

    it("a holder account is BLAKE2b-256(0^32 ‖ hashedUserId)", () => {
      assertEqual(
        holderAccountId(USER_ID),
        "d2a28f963a887bf35b0e2377f602af3e2464f5b792cd5c04b5569dbe00249ba5",
      );
      assertEqual(
        holderAccountId("ff".repeat(32)),
        "a37f89c806e4483868c09b42cbb0d24e76ef09b17aac12ec77cd0b6e484fba11",
      );
      assertEqual(holderAccountFromHashedUserId(hashedUserId(USER_ID)), holderAccountId(USER_ID));
    });

    it("a p256 account is domain-separated over the compressed key", () => {
      const key = fromHex(`02${"44".repeat(32)}`);
      assertEqual(
        p256AccountId(key),
        "853c598e3033ccc578d6e8d5268dd525f8d58d1e3d3bb9d220773c50fe71c3a9",
      );
    });

    it("a device id is BLAKE2b-256 of the raw credential id", () => {
      const rawId = Uint8Array.from("credential-raw-id", (c) => c.charCodeAt(0));
      assertEqual(
        toHex(deviceId(rawId)),
        "f86db9d4f8b5278281c2c766f94fda4110d91fe15816a997bf9870fb7f520222",
      );
    });

    it("an EventId is BLAKE2b-256(tag ‖ creator ‖ salt)", () => {
      assertEqual(eventId(CREATOR, Uint8Array.of(1, 2, 3)), EVENT);
    });

    it("a TicketId is BLAKE2b-256(tag ‖ SCALE(event, zone, placement))", () => {
      assertEqual(
        ticketId(EVENT, ZONE, { kind: "Seated", position: "0a0c" as Position }),
        "5485a4c053a61838064c2f34ec2a0b3da31d8987c58d8b9438bca61634bef7fb",
      );
      assertEqual(
        ticketId(EVENT, ZONE, {
          kind: "Unseated",
          discriminator: "33".repeat(16) as Discriminator,
        }),
        "cb5dcc856d22d59acf234a53bfbb8cfc255b7c0ac5be3d322878baa3e283adcd",
      );
    });
  });

  describe("T-003-02 derivation, properties", () => {
    it("REQ-ID-1: changing zone or placement changes a TicketId; class or holder does not", () => {
      const random = new Random(0x71c3e7);
      for (let run = 0; run < 100; run++) {
        const issue = random.command("issueTicket");
        if (issue.kind !== "issueTicket") throw new Error("unreachable");
        const id = ticketId(issue.event, issue.zone, issue.placement);

        assert(ticketId(issue.event, random.zoneId(), issue.placement) !== id, "zone changes it");
        const other = random.placement();
        if (JSON.stringify(other) !== JSON.stringify(issue.placement)) {
          assert(ticketId(issue.event, issue.zone, other) !== id, "placement changes it");
        }
        assert(ticketId(random.eventId(), issue.zone, issue.placement) !== id, "event changes it");

        // Class and holder are not inputs: a reissue differing only in them derives the same id.
        const reissue = { ...issue, class: random.classId(), holder: random.accountId() };
        assertEqual(ticketId(reissue.event, reissue.zone, reissue.placement), id);
      }
    });

    it("REQ-EV-9: an EventId depends on creator and salt", () => {
      const random = new Random(0xe7e7);
      for (let run = 0; run < 100; run++) {
        const creator = random.accountId();
        const salt = random.bytes(1 + random.below(32));
        const id = eventId(creator, salt);
        assertEqual(eventId(creator, salt.slice()), id, "a replay derives the same id");
        assert(eventId(random.accountId(), salt) !== id, "creator changes it");
        const changed = salt.slice();
        changed[0] = (changed[0] ?? 0) ^ 1;
        assert(eventId(creator, changed) !== id, "salt changes it");
      }
    });

    it("a seated position and an unseated discriminator with the same bytes differ", () => {
      const bytes = "55".repeat(16);
      assert(
        ticketId(EVENT, ZONE, { kind: "Seated", position: bytes as Position }) !==
          ticketId(EVENT, ZONE, { kind: "Unseated", discriminator: bytes as Discriminator }),
      );
    });

    it("refuses a user id that is not 32 bytes of lower-case hex", () => {
      assertThrows(() => holderAccountId("alice@example.com"), "TypeError");
      assertThrows(() => holderAccountId(USER_ID.toUpperCase()), "TypeError");
      assertThrows(() => holderAccountId(USER_ID.slice(2)), "TypeError");
    });

    it("refuses a p256 key that is not compressed", () => {
      assertThrows(() => p256AccountId(new Uint8Array(65).fill(4)), "TypeError");
      assertThrows(() => p256AccountId(new Uint8Array(33).fill(4)), "TypeError");
    });
  });
};
