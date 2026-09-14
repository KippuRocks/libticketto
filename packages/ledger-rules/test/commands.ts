// One well-formed command of each kind, for tests that sweep every command.

import type {
  AccountId,
  ClassId,
  Command,
  CommandKind,
  Discriminator,
  EventId,
  ProofId,
  Registration,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";
import { envelope, id32, zoneId } from "./fixtures.js";

/** A command of `kind` against `event`, with a fresh envelope. */
export function commandOf(
  kind: CommandKind,
  event: EventId,
  options: { readonly expiresAt?: Timestamp; readonly account?: AccountId } = {},
): Command {
  const base = envelope(options.expiresAt);
  const ticket = id32<TicketId>();
  const holder = options.account ?? id32<AccountId>();
  switch (kind) {
    case "createEvent":
      return {
        ...base,
        kind,
        event,
        salt: new Uint8Array([1, 2, 3]),
        zones: [],
        capacity: null,
        metadata: null,
      };
    case "setEventStatus":
      return { ...base, kind, event, status: "Sealed" };
    case "setEventCapacity":
      return { ...base, kind, event, capacity: 10, proof: "aa" as ProofId };
    case "addZone":
      return { ...base, kind, event, zone: { id: zoneId(), kind: "Unseated" } };
    case "removeZone":
      return { ...base, kind, event, zone: zoneId() };
    case "issueTicket":
      return {
        ...base,
        kind,
        event,
        ticket,
        zone: zoneId(),
        placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
        class: "01" as ClassId,
        provenance: "Granted",
        policy: { kind: "Single" },
        restrictions: { cannotResale: false, cannotTransfer: false },
        holder,
        metadata: null,
      };
    case "transferTicket":
      return { ...base, kind, event, ticket, receiver: holder };
    case "removeRestriction":
      return { ...base, kind, event, ticket, restriction: "cannotTransfer" };
    case "registerCredential":
      return { ...base, kind, account: holder, registration: new Uint8Array([0]) as Registration };
    default:
      throw new Error(`no fixture for ${kind}`);
  }
}

/** A granted, unrestricted ticket of `event`, held by `holder`. */
export function ticketIn(event: EventId, id: TicketId, holder: AccountId): Ticket {
  return {
    id,
    event,
    holder,
    class: "01" as ClassId,
    provenance: "Granted",
    zone: zoneId(),
    placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
    policy: { kind: "Single" },
    restrictions: { cannotResale: false, cannotTransfer: false },
    attendances: 0,
  };
}

/** Every command kind that names an existing event. */
export const EXISTING_EVENT_COMMAND_KINDS: readonly CommandKind[] = [
  "setEventStatus",
  "setEventCapacity",
  "addZone",
  "removeZone",
  "issueTicket",
  "transferTicket",
  "removeRestriction",
];

/** Every command kind that names an existing ticket. */
export const EXISTING_TICKET_COMMAND_KINDS: readonly CommandKind[] = [
  "transferTicket",
  "removeRestriction",
];

/** Every command kind that names an event. */
export const EVENT_COMMAND_KINDS: readonly CommandKind[] = [
  "createEvent",
  "setEventStatus",
  "setEventCapacity",
  "addZone",
  "removeZone",
  "issueTicket",
  "transferTicket",
  "removeRestriction",
];
