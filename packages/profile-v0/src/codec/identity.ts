// Codecs for identity components and the domain values commands carry
// (features/003-profile-v0/plan.md §5.1, §5.3).
//
// Widths follow plan §5.3: `EventId`, `TicketId`, `ZoneId` and `AccountId` are
// 32 bytes; an unseated discriminator, a `PassId` and an `OperationId` are 16.
// Identifiers the plan gives no width — `ClassId`, `ProofId`, a seat `Position` —
// are length-prefixed byte strings. `MetadataLocator` is a UTF-8 string.

import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Discriminator,
  EventId,
  EventStatus,
  OperationId,
  PassId,
  Placement,
  Position,
  ProofId,
  Provenance,
  Restriction,
  TicketId,
  TicketRestrictions,
  Zone,
  ZoneId,
  ZoneKind,
} from "@ticketto/sdk";
import { bool, type Codec, createCodec, createDecoder, Struct, str, u8 } from "scale-ts";
import { concatBytes } from "../bytes.js";
import {
  count,
  DecodeError,
  fixedHex,
  nullable,
  timestamp,
  unitEnum,
  variableHex,
} from "./scale.js";

/** Bytes in a 32-byte identifier: `EventId`, `TicketId`, `ZoneId`, `AccountId`. */
export const ID_LENGTH = 32;
/** Bytes in a 128-bit random identifier: a discriminator, `PassId`, `OperationId` (`AD-12`). */
export const RANDOM_ID_LENGTH = 16;

export const eventId: Codec<EventId> = fixedHex<EventId>(ID_LENGTH);
export const ticketId: Codec<TicketId> = fixedHex<TicketId>(ID_LENGTH);
export const zoneId: Codec<ZoneId> = fixedHex<ZoneId>(ID_LENGTH);
export const accountId: Codec<AccountId> = fixedHex<AccountId>(ID_LENGTH);
export const discriminator: Codec<Discriminator> = fixedHex<Discriminator>(RANDOM_ID_LENGTH);
export const passId: Codec<PassId> = fixedHex<PassId>(RANDOM_ID_LENGTH);
export const operationId: Codec<OperationId> = fixedHex<OperationId>(RANDOM_ID_LENGTH);
export const classId: Codec<ClassId> = variableHex<ClassId>();
export const proofId: Codec<ProofId> = variableHex<ProofId>();
export const position: Codec<Position> = variableHex<Position>();
export const metadataLocator: Codec<string> = str;

export const zoneKind: Codec<ZoneKind> = unitEnum<ZoneKind>(["Seated", "Unseated"]);

export const zone: Codec<Zone> = Struct({ id: zoneId, kind: zoneKind });

export const eventStatus: Codec<EventStatus> = unitEnum<EventStatus>([
  "Active",
  "Sealed",
  "Cancelled",
  "Finished",
]);

export const provenance: Codec<Provenance> = unitEnum<Provenance>(["Purchased", "Granted"]);

export const restriction: Codec<Restriction> = unitEnum<Restriction>([
  "cannotResale",
  "cannotTransfer",
]);

export const ticketRestrictions: Codec<TicketRestrictions> = Struct({
  cannotResale: bool,
  cannotTransfer: bool,
});

/** `Placement`: index 0 `Seated { position }`, index 1 `Unseated { discriminator }` (SPEC.md §5.5). */
export const placement: Codec<Placement> = createCodec(
  (value: Placement) => {
    switch (value.kind) {
      case "Seated":
        return concatBytes(Uint8Array.of(0), position.enc(value.position));
      case "Unseated":
        return concatBytes(Uint8Array.of(1), discriminator.enc(value.discriminator));
      default:
        throw new TypeError("unknown placement kind");
    }
  },
  createDecoder((input): Placement => {
    const index = u8.dec(input);
    if (index === 0) return { kind: "Seated", position: position.dec(input) };
    if (index === 1) return { kind: "Unseated", discriminator: discriminator.dec(input) };
    throw new DecodeError(`unknown placement index ${index}`);
  }),
);

const optionalTimestamp = nullable(timestamp);

/**
 * `AttendancePolicy`: index 0 `Single`, 1 `Multiple { max, until }`,
 * 2 `Unlimited { until }` (SPEC.md §5.2).
 */
export const attendancePolicy: Codec<AttendancePolicy> = createCodec(
  (value: AttendancePolicy) => {
    switch (value.kind) {
      case "Single":
        return Uint8Array.of(0);
      case "Multiple":
        return concatBytes(
          Uint8Array.of(1),
          count.enc(value.max),
          optionalTimestamp.enc(value.until),
        );
      case "Unlimited":
        return concatBytes(Uint8Array.of(2), optionalTimestamp.enc(value.until));
      default:
        throw new TypeError("unknown attendance policy kind");
    }
  },
  createDecoder((input): AttendancePolicy => {
    const index = u8.dec(input);
    if (index === 0) return { kind: "Single" };
    if (index === 1) {
      const max = count.dec(input);
      return { kind: "Multiple", max, until: optionalTimestamp.dec(input) };
    }
    if (index === 2) return { kind: "Unlimited", until: optionalTimestamp.dec(input) };
    throw new DecodeError(`unknown attendance policy index ${index}`);
  }),
);
