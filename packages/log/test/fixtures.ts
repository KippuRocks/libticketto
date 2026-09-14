// Deterministic sample inputs for the log's tests: one signed command of every
// V0 kind, and a signed access pass. Keys are fixed, and p256 signing is
// deterministic, so the same inputs come out on every run.

import { commandSigningPayload, eventId, producePass, ticketId } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import type {
  AccountId,
  ClassId,
  Command,
  CommandKind,
  Discriminator,
  EventId,
  OperationId,
  PassId,
  ProofId,
  SignedAccessPass,
  SignedCommand,
  ZoneId,
} from "@ticketto/sdk";
import type { ChainedRecord, LogInput } from "../src/index.js";

function filled(length: number, byte: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

function hex(length: number, byte: number): string {
  return byte.toString(16).padStart(2, "0").repeat(length);
}

export const organiser = softwareP256Signer({ secretKey: filled(32, 0x11) });
export const holder = softwareP256Signer({ secretKey: filled(32, 0x22) });

export const salt = filled(16, 0x5a);
export const event: EventId = eventId(organiser.signer.account, salt);
export const zone = hex(32, 0x7a) as ZoneId;
export const placement = {
  kind: "Unseated",
  discriminator: hex(16, 0xd1) as Discriminator,
} as const;
export const ticket = ticketId(event, zone, placement);

const envelope = (n: number) => ({
  operationId: hex(16, n) as OperationId,
  expiresAt: 1_900_000_000_000 + n,
});

/** One command of every V0 kind, in the SDK's order. */
export const COMMANDS: Readonly<Record<CommandKind, Command>> = {
  createEvent: {
    kind: "createEvent",
    ...envelope(1),
    event,
    salt,
    zones: [{ id: zone, kind: "Unseated" }],
    capacity: 100,
    metadata: "kippu://events/sample",
  },
  setEventStatus: { kind: "setEventStatus", ...envelope(2), event, status: "Sealed" },
  setEventCapacity: {
    kind: "setEventCapacity",
    ...envelope(3),
    event,
    capacity: 200,
    proof: "c0ffee" as ProofId,
  },
  addZone: {
    kind: "addZone",
    ...envelope(4),
    event,
    zone: { id: hex(32, 0x7b) as ZoneId, kind: "Seated" },
  },
  removeZone: { kind: "removeZone", ...envelope(5), event, zone: hex(32, 0x7b) as ZoneId },
  issueTicket: {
    kind: "issueTicket",
    ...envelope(6),
    event,
    ticket,
    zone,
    placement,
    class: "0a0b" as ClassId,
    provenance: "Granted",
    policy: { kind: "Multiple", max: 3, until: null },
    restrictions: { cannotResale: true, cannotTransfer: false },
    holder: holder.signer.account,
    metadata: null,
  },
  transferTicket: {
    kind: "transferTicket",
    ...envelope(7),
    event,
    ticket,
    receiver: hex(32, 0x99) as AccountId,
  },
  removeRestriction: {
    kind: "removeRestriction",
    ...envelope(8),
    event,
    ticket,
    restriction: "cannotResale",
  },
  registerCredential: {
    kind: "registerCredential",
    ...envelope(9),
    account: holder.signer.account,
    registration: holder.registration,
  },
};

export async function signCommand(command: Command): Promise<SignedCommand> {
  const signer = command.kind === "registerCredential" ? holder.signer : organiser.signer;
  return { command, authorisation: await signer.sign(commandSigningPayload(command)) };
}

export async function samplePass(): Promise<SignedAccessPass> {
  return producePass(
    {
      ticket,
      holder: holder.signer.account,
      notBefore: 1_800_000_000_000,
      id: hex(16, 0xab) as PassId,
    },
    holder.signer,
  );
}

/** The event reference a record of `input` carries, at `sequence` in that event. */
export function eventOf(input: LogInput, sequence: number): ChainedRecord["event"] {
  if ("pass" in input) return { id: event, sequence };
  return "event" in input.command ? { id: input.command.event, sequence } : null;
}
