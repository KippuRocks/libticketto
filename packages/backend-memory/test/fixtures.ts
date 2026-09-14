// Deterministic inputs for this package's tests: signed commands and a signed
// access pass the log can carry. Keys are fixed and public — tests only.

import { commandSigningPayload, eventId, producePass, ticketId } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import type {
  Discriminator,
  EventId,
  OperationId,
  PassId,
  SignedAccessPass,
  SignedCommand,
  ZoneId,
} from "@ticketto/sdk";

function hex(length: number, byte: number): string {
  return byte.toString(16).padStart(2, "0").repeat(length);
}

export const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x11) });
export const holder = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x22) });

export const salt = new Uint8Array(16).fill(0x5a);
export const event: EventId = eventId(organiser.signer.account, salt);
export const otherEvent: EventId = eventId(organiser.signer.account, new Uint8Array(16).fill(0x5b));
export const zone = hex(32, 0x7a) as ZoneId;
export const placement = {
  kind: "Unseated",
  discriminator: hex(16, 0xd1) as Discriminator,
} as const;
export const ticket = ticketId(event, zone, placement);

/** A signed `setEventStatus` for `on`, with operation id `n`. */
export async function statusCommand(n: number, on: EventId = event): Promise<SignedCommand> {
  const command = {
    kind: "setEventStatus",
    operationId: hex(16, n) as OperationId,
    expiresAt: 1_900_000_000_000,
    event: on,
    status: "Sealed",
  } as const;
  return { command, authorisation: await organiser.signer.sign(commandSigningPayload(command)) };
}

/** A signed `registerCredential`, which names no event, with operation id `n`. */
export async function registerCommand(n: number): Promise<SignedCommand> {
  const command = {
    kind: "registerCredential",
    operationId: hex(16, n) as OperationId,
    expiresAt: 1_900_000_000_000,
    account: holder.signer.account,
    registration: holder.registration,
  } as const;
  return { command, authorisation: await holder.signer.sign(commandSigningPayload(command)) };
}

/** A signed access pass for `ticket`, with pass id `n`. */
export function signedPass(n = 0xab): Promise<SignedAccessPass> {
  return producePass(
    {
      ticket,
      holder: holder.signer.account,
      notBefore: 1_800_000_000_000,
      id: hex(16, n) as PassId,
    },
    holder.signer,
  );
}
