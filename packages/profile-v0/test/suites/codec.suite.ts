// T-003-01 — round-trip properties of every codec (REQ-CP-1, REQ-CM-1).
// Runs under Vitest (src/codec/codec.test.ts) and under Hermes (test/hermes).

import type { AccountId, EventId, TransferTicket } from "@ticketto/sdk";
import type { Codec } from "scale-ts";
import { concatBytes } from "../../src/bytes.js";
import { COMMAND_INDEX, command, decodeCommand, encodeCommand } from "../../src/codec/command.js";
import * as identity from "../../src/codec/identity.js";
import {
  boundedBytes,
  count,
  DecodeError,
  decodeExact,
  decodeVersioned,
  FORMAT_VERSION,
  timestamp,
} from "../../src/codec/scale.js";
import { assert, assertEqual, assertThrows, type Suite } from "../harness.js";
import { Random } from "../random.js";

const RUNS = 200;
const SEED = 0x7ec0de;

function roundTrips<T>(codec: Codec<T>, make: (random: Random) => T, seed: number): void {
  const random = new Random(seed);
  for (let run = 0; run < RUNS; run++) {
    const value = make(random);
    const bytes = codec.enc(value);
    assertEqual(decodeExact(codec, bytes), value, `run ${run}: decode(encode(v)) differs`);
    assertEqual(codec.enc(decodeExact(codec, bytes)), bytes, `run ${run}: re-encoding differs`);
  }
}

export const codecSuite: Suite = ({ describe, it }) => {
  describe("T-003-01 codecs round-trip", () => {
    const components: [string, Codec<unknown>, (r: Random) => unknown][] = [
      ["EventId", identity.eventId as Codec<unknown>, (r) => r.eventId()],
      ["TicketId", identity.ticketId as Codec<unknown>, (r) => r.ticketId()],
      ["ZoneId", identity.zoneId as Codec<unknown>, (r) => r.zoneId()],
      ["AccountId", identity.accountId as Codec<unknown>, (r) => r.accountId()],
      ["OperationId", identity.operationId as Codec<unknown>, (r) => r.operationId()],
      ["PassId", identity.passId as Codec<unknown>, (r) => r.hex(16)],
      ["Discriminator", identity.discriminator as Codec<unknown>, (r) => r.discriminator()],
      ["Position", identity.position as Codec<unknown>, (r) => r.position()],
      ["ClassId", identity.classId as Codec<unknown>, (r) => r.classId()],
      ["ProofId", identity.proofId as Codec<unknown>, (r) => r.proofId()],
      ["MetadataLocator", identity.metadataLocator as Codec<unknown>, (r) => r.text()],
      ["Zone", identity.zone as Codec<unknown>, (r) => r.zone()],
      ["Placement", identity.placement as Codec<unknown>, (r) => r.placement()],
      ["AttendancePolicy", identity.attendancePolicy as Codec<unknown>, (r) => r.policy()],
      [
        "EventStatus",
        identity.eventStatus as Codec<unknown>,
        (r) => r.pick(["Active", "Sealed", "Cancelled", "Finished"]),
      ],
      [
        "Provenance",
        identity.provenance as Codec<unknown>,
        (r) => r.pick(["Purchased", "Granted"]),
      ],
      [
        "Restriction",
        identity.restriction as Codec<unknown>,
        (r) => r.pick(["cannotResale", "cannotTransfer"]),
      ],
      [
        "TicketRestrictions",
        identity.ticketRestrictions as Codec<unknown>,
        (r) => ({ cannotResale: r.bool(), cannotTransfer: r.bool() }),
      ],
      ["Timestamp", timestamp as Codec<unknown>, (r) => r.timestamp()],
      ["Count", count as Codec<unknown>, (r) => r.count()],
      ["bytes", boundedBytes as Codec<unknown>, (r) => r.bytes(r.below(100))],
    ];
    components.forEach(([name, codec, make], index) => {
      it(`${name}`, () => roundTrips(codec, make, SEED + index));
    });

    for (const kind of Object.keys(COMMAND_INDEX) as (keyof typeof COMMAND_INDEX)[]) {
      it(`command ${kind}, versioned`, () => {
        const random = new Random(SEED ^ ((COMMAND_INDEX[kind] + 1) * 7919));
        for (let run = 0; run < RUNS; run++) {
          const value = random.command(kind);
          const bytes = encodeCommand(value);
          assert(bytes[0] === FORMAT_VERSION, "starts with the format version");
          assert(bytes[25] === COMMAND_INDEX[kind], "carries its kind index after the envelope");
          assertEqual(decodeCommand(bytes), value, `run ${run}: decode(encode(v)) differs`);
        }
      });
    }
  });

  describe("T-003-01 codecs refuse non-canonical input", () => {
    it("a command with an unknown format version", () => {
      const bytes = encodeCommand(new Random(1).command());
      bytes[0] = FORMAT_VERSION + 1;
      assertThrows(() => decodeCommand(bytes), "DecodeError");
    });

    it("a command with trailing bytes, or truncated", () => {
      const random = new Random(2);
      for (let run = 0; run < RUNS; run++) {
        const bytes = encodeCommand(random.command());
        assertThrows(() => decodeCommand(concatBytes(bytes, Uint8Array.of(0))), "DecodeError");
        const cut = 1 + random.below(bytes.length - 1);
        assertThrows(() => decodeCommand(bytes.subarray(0, cut)), "DecodeError");
      }
    });

    it("an unknown command index", () => {
      const bytes = encodeCommand(new Random(3).command("removeZone"));
      bytes[25] = 0xff;
      assertThrows(() => decodeCommand(bytes), "DecodeError");
    });

    it("a non-minimal compact length", () => {
      // 0 encoded in two-byte mode rather than one.
      assertThrows(() => decodeExact(boundedBytes, Uint8Array.of(0b01, 0)), "DecodeError");
    });

    it("a length prefix beyond the input", () => {
      assertThrows(
        () => decodeExact(boundedBytes, Uint8Array.of(0xfe, 0xff, 0xff, 0xff)),
        "DecodeError",
      );
    });

    it("a boolean other than 0 or 1", () => {
      assertThrows(
        () => decodeExact(identity.ticketRestrictions, Uint8Array.of(2, 0)),
        "DecodeError",
      );
    });

    it("an option tag other than 0 or 1", () => {
      const bytes = encodeCommand(new Random(4).command("setEventCapacity"));
      // version, envelope (24), index, event (32): the capacity option follows.
      bytes[58] = 2;
      assertThrows(() => decodeCommand(bytes), "DecodeError");
    });

    it("a timestamp beyond the safe integer range", () => {
      const max = new Uint8Array(8).fill(0xff);
      assertThrows(() => decodeExact(timestamp, max), "DecodeError");
    });

    it("upper-case or malformed hex on encode", () => {
      const random = new Random(5);
      const value = random.command("transferTicket") as TransferTicket;
      assertThrows(() => command.enc({ ...value, event: value.event.toUpperCase() as EventId }));
      assertThrows(() => command.enc({ ...value, receiver: "00" as AccountId }));
    });

    it("the offset of a view is respected", () => {
      const inner = encodeCommand(new Random(6).command());
      const framed = concatBytes(Uint8Array.of(9, 9, 9), inner);
      assertEqual(decodeCommand(framed.subarray(3)), decodeCommand(inner));
    });

    it("decoding errors are DecodeError", () => {
      assertThrows(() => decodeVersioned(command, new Uint8Array(0)), "DecodeError");
      assert(new DecodeError("x") instanceof Error);
    });
  });
};
