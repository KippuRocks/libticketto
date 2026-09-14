// Steps the suites share — features/004-conformance/plan.md §5.1.
//
// Written against the SDK surface (C1) and the backend port (C8) only. Values
// with a profile-defined encoding come from the target's identifiers.

import type {
  AccountId,
  AttendancePolicy,
  Command,
  Count,
  Event,
  EventId,
  OperationEnvelope,
  OperationId,
  Placement,
  Provenance,
  Receipt,
  Result,
  SignedCommand,
  Signer,
  Submission,
  Ticket,
  TicketId,
  TicketRestrictions,
  Zone,
  ZoneId,
} from "@ticketto/sdk";
import { expect } from "vitest";
import { expectOk } from "./expect.js";
import { OPERATION_LIFETIME, type World } from "./world.js";

/** The zones `createEventWith` makes unless told otherwise: zone 0 seated, zone 1 unseated. */
export function standardZones(world: World): Zone[] {
  return [
    { id: world.identifiers.zone(0), kind: "Seated" },
    { id: world.identifiers.zone(1), kind: "Unseated" },
  ];
}

export interface EventOptions {
  readonly signer?: Signer;
  readonly salt?: number;
  readonly zones?: readonly Zone[];
  readonly capacity?: Count | null;
}

/** Creates an event, asserts it settled, and returns its id. */
export async function createEventWith(world: World, options: EventOptions = {}): Promise<EventId> {
  const { id, submission } = world.ticketto.createEvent(options.signer ?? world.organiser, {
    salt: world.identifiers.salt(options.salt ?? 0),
    zones: options.zones ?? standardZones(world),
    capacity: options.capacity === undefined ? null : options.capacity,
    metadata: null,
  });
  await expectOk(submission);
  return id;
}

export interface IssueOptions {
  readonly signer?: Signer;
  readonly zone?: ZoneId;
  readonly placement?: Placement;
  readonly class?: number;
  readonly provenance?: Provenance;
  readonly policy?: AttendancePolicy;
  readonly restrictions?: TicketRestrictions;
  readonly holder?: AccountId;
}

export const UNRESTRICTED: TicketRestrictions = { cannotResale: false, cannotTransfer: false };

/** A seated placement at position `index`. */
export function seat(world: World, index: number): Placement {
  return { kind: "Seated", position: world.identifiers.position(index) };
}

/** An unseated placement with discriminator `index`. */
export function standing(world: World, index: number): Placement {
  return { kind: "Unseated", discriminator: world.identifiers.discriminator(index) };
}

/**
 * Issues a ticket in `event` — by default a purchased, unrestricted, single-entry
 * ticket at seat 0 of zone 0, held by holder 0 — and returns its id and submission.
 */
export function issue(
  world: World,
  event: EventId,
  options: IssueOptions = {},
): { id: TicketId; submission: Submission<Receipt> } {
  return world.ticketto.issueTicket(options.signer ?? world.organiser, {
    event,
    zone: options.zone ?? world.identifiers.zone(0),
    placement: options.placement ?? seat(world, 0),
    class: world.identifiers.class(options.class ?? 0),
    provenance: options.provenance ?? "Purchased",
    policy: options.policy ?? { kind: "Single" },
    restrictions: options.restrictions ?? UNRESTRICTED,
    holder: options.holder ?? (world.holders[0] as Signer).account,
    metadata: null,
  });
}

/** Issues a ticket, asserts it settled, and returns its id. */
export async function issued(world: World, event: EventId, options: IssueOptions = {}) {
  const { id, submission } = issue(world, event, options);
  await expectOk(submission);
  return id;
}

/** The event as the ledger records it; asserts the query answered. */
export function eventOf(world: World, event: EventId): Promise<Event> {
  return expectOk(world.ticketto.getEvent(event));
}

/** The ticket as the ledger records it; asserts the query answered. */
export function ticketOf(world: World, ticket: TicketId): Promise<Ticket> {
  return expectOk(world.ticketto.getTicket(ticket));
}

/** A fresh operation envelope on the backend's clock and randomness. */
export function envelope(world: World): OperationEnvelope {
  let id = "";
  for (const byte of world.backend.randomBytes(16)) id += byte.toString(16).padStart(2, "0");
  return {
    operationId: id as OperationId,
    expiresAt: world.backend.clock.now() + OPERATION_LIFETIME,
  };
}

/** Signs `command` with `signer` over the profile's signing payload, as the SDK does. */
export async function sign(world: World, signer: Signer, command: Command): Promise<SignedCommand> {
  return { command, authorisation: await signer.sign(world.profile.encodeCommand(command)) };
}

/** Sponsors a signed command and submits it through the port, as the SDK does, and awaits it. */
export async function submitSigned(world: World, signed: SignedCommand): Promise<Result<Receipt>> {
  const sponsorship = await world.signers.sponsor.sponsor(signed);
  expect(sponsorship.ok, "the fixture sponsor refused").toBe(true);
  if (!sponsorship.ok) return sponsorship;
  return await world.backend.submit({ kind: "command", signed }, sponsorship.value);
}

/** Moves the event through the transitions to `status`, asserting each settled. */
export async function moveTo(
  world: World,
  event: EventId,
  ...statuses: readonly Event["status"][]
): Promise<void> {
  for (const status of statuses) {
    await expectOk(world.ticketto.setEventStatus(world.organiser, { event, status }));
  }
}
