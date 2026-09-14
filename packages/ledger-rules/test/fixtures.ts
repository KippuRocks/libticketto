// Shared fixtures for the rules' unit tests: the V0 profile, software
// credentials registered in fake capabilities, and command builders.

import { createProfileV0 } from "@ticketto/profile-v0";
import { type SoftwareCredential, softwareP256Signer } from "@ticketto/profile-v0/testing";
import type {
  AccountId,
  Command,
  CreateEvent,
  CredentialId,
  EventId,
  OperationId,
  Profile,
  SignedCommand,
  Timestamp,
  ZoneId,
} from "@ticketto/sdk";
import type { Capabilities } from "../src/index.js";

export const profile: Profile = createProfileV0({ rpId: "kippu.test" });

/** A software credential, with the account and credential id its registration names. */
export interface TestCredential extends SoftwareCredential {
  readonly account: AccountId;
  readonly credential: CredentialId;
}

export function credential(): TestCredential {
  const software = softwareP256Signer();
  const named = profile.registrationAccount(software.registration);
  if (!named.ok) throw new Error("a software credential always registers");
  return { ...software, ...named.value };
}

/** Records a credential's registration directly in the registry, as if registered earlier. */
export async function register(caps: Capabilities, who: TestCredential): Promise<void> {
  await caps.registry.addRegistration(who.account, {
    credential: who.credential,
    registration: who.registration,
  });
}

/** A fresh credential, already registered. */
export async function registered(caps: Capabilities): Promise<TestCredential> {
  const who = credential();
  await register(caps, who);
  return who;
}

export async function sign<C extends Command>(
  who: { readonly signer: SoftwareCredential["signer"] },
  command: C,
): Promise<SignedCommand & { readonly command: C }> {
  const authorisation = await who.signer.sign(profile.encodeCommand(command));
  return { command, authorisation };
}

let counter = 0;
function hex(bytes: number, seed: number): string {
  return seed.toString(16).padStart(bytes * 2, "0");
}

/** A fresh operation id. */
export function operationId(): OperationId {
  counter += 1;
  return hex(16, counter) as OperationId;
}

/** A fresh 32-byte id. */
export function id32<T extends string>(): T {
  counter += 1;
  return hex(32, counter) as T;
}

export const zoneId = (): ZoneId => id32<ZoneId>();
export const eventId = (): EventId => id32<EventId>();

/** An envelope valid until `expiresAt`. */
export function envelope(expiresAt: Timestamp = 60_000) {
  return { operationId: operationId(), expiresAt };
}

/** A `createEvent` whose id is the profile's derivation from `creator` and `salt`. */
export function createEventCommand(
  creator: AccountId,
  options: {
    readonly salt?: Uint8Array;
    readonly zones?: CreateEvent["zones"];
    readonly capacity?: CreateEvent["capacity"];
    readonly expiresAt?: Timestamp;
  } = {},
): CreateEvent {
  const salt = options.salt ?? new Uint8Array([7, 7, 7]);
  return {
    ...envelope(options.expiresAt),
    kind: "createEvent",
    event: profile.eventId(creator, salt),
    salt,
    zones: options.zones ?? [],
    capacity: options.capacity ?? null,
    metadata: null,
  };
}
