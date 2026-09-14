// The canonical bytes of every V0 command (REQ-CP-1, REQ-CM-1;
// features/003-profile-v0/plan.md §5.1).
//
//   Command = version u8, operationId [u8;16], expiresAt u64, kind u8, body
//
// The operation envelope (AD-15) comes first, so every command carries it in
// the same place. `kind` indexes the variants below in the order of the SDK's
// `Command` union; a beyond-V0 command takes the next free index, and an
// existing index is never reused.

import type {
  AddZone,
  Command,
  CommandKind,
  CreateEvent,
  IssueTicket,
  RegisterCredential,
  RemoveRestriction,
  RemoveZone,
  SetEventCapacity,
  SetEventStatus,
  TransferTicket,
} from "@ticketto/sdk";
import { type Codec, createCodec, createDecoder, Struct, u8 } from "scale-ts";
import { concatBytes } from "../bytes.js";
import {
  accountId,
  attendancePolicy,
  classId,
  eventId,
  eventStatus,
  metadataLocator,
  operationId,
  placement,
  proofId,
  provenance,
  restriction,
  ticketId,
  ticketRestrictions,
  zone,
  zoneId,
} from "./identity.js";
import {
  boundedBytes,
  boundedVector,
  count,
  DecodeError,
  decodeVersioned,
  encodeVersioned,
  nullable,
  timestamp,
} from "./scale.js";

type Body<C extends Command> = Omit<C, "kind" | "operationId" | "expiresAt">;

const createEventBody: Codec<Body<CreateEvent>> = Struct({
  event: eventId,
  salt: boundedBytes,
  zones: boundedVector(zone),
  capacity: nullable(count),
  metadata: nullable(metadataLocator),
});

const setEventStatusBody: Codec<Body<SetEventStatus>> = Struct({
  event: eventId,
  status: eventStatus,
});

const setEventCapacityBody: Codec<Body<SetEventCapacity>> = Struct({
  event: eventId,
  capacity: nullable(count),
  proof: nullable(proofId),
});

const addZoneBody: Codec<Body<AddZone>> = Struct({ event: eventId, zone });

const removeZoneBody: Codec<Body<RemoveZone>> = Struct({ event: eventId, zone: zoneId });

const issueTicketBody: Codec<Body<IssueTicket>> = Struct({
  event: eventId,
  ticket: ticketId,
  zone: zoneId,
  placement,
  class: classId,
  provenance,
  policy: attendancePolicy,
  restrictions: ticketRestrictions,
  holder: accountId,
  metadata: nullable(metadataLocator),
});

const transferTicketBody: Codec<Body<TransferTicket>> = Struct({
  event: eventId,
  ticket: ticketId,
  receiver: accountId,
});

const removeRestrictionBody: Codec<Body<RemoveRestriction>> = Struct({
  event: eventId,
  ticket: ticketId,
  restriction,
});

// The registration stays opaque bytes here: only the profile's credential
// codecs read it (REQ-CP-3).
const registerCredentialBody = Struct({
  account: accountId,
  registration: boundedBytes,
}) as unknown as Codec<Body<RegisterCredential>>;

/** Wire index and body codec of each command kind. Indexes are part of `C2`. */
const BODIES: readonly { readonly kind: CommandKind; readonly body: Codec<object> }[] = [
  { kind: "createEvent", body: createEventBody },
  { kind: "setEventStatus", body: setEventStatusBody },
  { kind: "setEventCapacity", body: setEventCapacityBody },
  { kind: "addZone", body: addZoneBody },
  { kind: "removeZone", body: removeZoneBody },
  { kind: "issueTicket", body: issueTicketBody },
  { kind: "transferTicket", body: transferTicketBody },
  { kind: "removeRestriction", body: removeRestrictionBody },
  { kind: "registerCredential", body: registerCredentialBody },
] as unknown as readonly { readonly kind: CommandKind; readonly body: Codec<object> }[];

/** The wire index of each command kind. */
export const COMMAND_INDEX: Readonly<Record<CommandKind, number>> = Object.fromEntries(
  BODIES.map(({ kind }, index) => [kind, index]),
) as Record<CommandKind, number>;

/** A command without its format version. */
export const command: Codec<Command> = createCodec(
  (value: Command) => {
    const index = BODIES.findIndex(({ kind }) => kind === value.kind);
    const entry = BODIES[index];
    if (entry === undefined) throw new TypeError(`unknown command kind ${String(value.kind)}`);
    return concatBytes(
      operationId.enc(value.operationId),
      timestamp.enc(value.expiresAt),
      u8.enc(index),
      entry.body.enc(value),
    );
  },
  createDecoder((input): Command => {
    const envelope = {
      operationId: operationId.dec(input),
      expiresAt: timestamp.dec(input),
    };
    const index = u8.dec(input);
    const entry = BODIES[index];
    if (entry === undefined) throw new DecodeError(`unknown command index ${index}`);
    return { kind: entry.kind, ...envelope, ...entry.body.dec(input) } as Command;
  }),
);

/** The canonical bytes a signer authorises for `value` (`Profile.encodeCommand`). */
export function encodeCommand(value: Command): Uint8Array {
  return encodeVersioned(command, value);
}

/** The command `bytes` canonically encode. Throws `DecodeError` otherwise. */
export function decodeCommand(bytes: Uint8Array): Command {
  return decodeVersioned(command, bytes);
}
