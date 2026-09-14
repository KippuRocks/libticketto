// Commands, queries and the operation envelope — features/002-sdk/plan.md
// §5.4–§5.6, SPEC.md §8.
//
// `Command` is a discriminated union on `kind`, holding every V0 command that
// is signed as a command. Beyond-V0 commands (listing, buying, deferred
// transfer) are not here; adding one later is additive, because no consumer
// may switch over every kind without a default (§5.6).
//
// An access pass is not a `Command`: nobody signs its submission, because the
// pass itself carries its holder's authorisation (REQ-OP-2). It is submitted as
// a `SignedAccessPass`.

import type { Authorisation, CredentialId, Registration } from "./credentials.js";
import type {
  AttendancePolicy,
  Event,
  EventStatus,
  Placement,
  Provenance,
  Ticket,
  TicketRestrictions,
  Zone,
} from "./domain.js";
import type { TickettoErrorCode } from "./generated/spec.js";
import type {
  AccountId,
  ClassId,
  Count,
  EventId,
  MetadataLocator,
  OperationId,
  PassId,
  ProofId,
  TicketId,
  Timestamp,
  ZoneId,
} from "./identifiers.js";

/**
 * Carried by every signed command, so that a replayed submission is rejected
 * or a no-op (`REQ-CM-1`, `AD-15`).
 */
export interface OperationEnvelope {
  readonly operationId: OperationId;
  /** After this instant the command fails with `ERR-OperationExpired`. */
  readonly expiresAt: Timestamp;
}

/**
 * `create_event` (`US-A1`). The event's id is derived through the profile from
 * the creator's account and `salt`, so a replay derives the same id and
 * collides (`REQ-EV-9`, `REQ-CM-1`).
 */
export interface CreateEvent extends OperationEnvelope {
  readonly kind: "createEvent";
  readonly event: EventId;
  readonly salt: Uint8Array;
  readonly zones: readonly Zone[];
  /** `null` leaves issuance unbounded (`REQ-EV-3`). */
  readonly capacity: Count | null;
  readonly metadata: MetadataLocator | null;
}

/** `set_event_status` (`US-A4`, `US-A5`, `REQ-EV-11`). */
export interface SetEventStatus extends OperationEnvelope {
  readonly kind: "setEventStatus";
  readonly event: EventId;
  readonly status: EventStatus;
}

/** `set_event_capacity` (`US-A6`). Asymmetric: an increase needs a proof (`REQ-EV-4`, `REQ-EV-5`). */
export interface SetEventCapacity extends OperationEnvelope {
  readonly kind: "setEventCapacity";
  readonly event: EventId;
  /** `null` removes the bound, which counts as an increase (`REQ-EV-7`). */
  readonly capacity: Count | null;
  readonly proof: ProofId | null;
}

/** `add_zone` (`REQ-ID-7`). */
export interface AddZone extends OperationEnvelope {
  readonly kind: "addZone";
  readonly event: EventId;
  readonly zone: Zone;
}

/** `remove_zone` (`REQ-ID-7`). */
export interface RemoveZone extends OperationEnvelope {
  readonly kind: "removeZone";
  readonly event: EventId;
  readonly zone: ZoneId;
}

/**
 * `issue_ticket` (`US-B1`–`US-B5`). The ticket's id is derived from event, zone
 * and placement, never allocated (`REQ-ID-1`). Policy and restrictions are those
 * the class determines (`REQ-TC-2`, `REQ-TK-4`); a holder is required (`INV-2`).
 */
export interface IssueTicket extends OperationEnvelope {
  readonly kind: "issueTicket";
  readonly event: EventId;
  readonly ticket: TicketId;
  readonly zone: ZoneId;
  readonly placement: Placement;
  readonly class: ClassId;
  readonly provenance: Provenance;
  readonly policy: AttendancePolicy;
  readonly restrictions: TicketRestrictions;
  readonly holder: AccountId;
  readonly metadata: MetadataLocator | null;
}

/** `transfer_ticket` (`US-D1`). */
export interface TransferTicket extends OperationEnvelope {
  readonly kind: "transferTicket";
  readonly event: EventId;
  readonly ticket: TicketId;
  readonly receiver: AccountId;
}

/** A ticket restriction, by its field name. */
export type Restriction = keyof TicketRestrictions;

/** `remove_restriction` (`REQ-TK-6`, `AC-B3.4`). Only ever clears a flag (`INV-10`). */
export interface RemoveRestriction extends OperationEnvelope {
  readonly kind: "removeRestriction";
  readonly event: EventId;
  readonly ticket: TicketId;
  readonly restriction: Restriction;
}

/**
 * `register_credential` (`REQ-CP-6`, `REQ-SP-1`). The registration is opaque to
 * the backend (`REQ-CP-3`). An account's first registration is signed by the new
 * credential itself; any further one by a credential already registered to it.
 */
export interface RegisterCredential extends OperationEnvelope {
  readonly kind: "registerCredential";
  readonly account: AccountId;
  readonly registration: Registration;
}

/** Every V0 command signed as a command. */
export type Command =
  | CreateEvent
  | SetEventStatus
  | SetEventCapacity
  | AddZone
  | RemoveZone
  | IssueTicket
  | TransferTicket
  | RemoveRestriction
  | RegisterCredential;

/** A command's discriminant. */
export type CommandKind = Command["kind"];

/**
 * An access pass (§5.3): what `REQ-AP-1`–`REQ-AP-5` require of one. Its canonical
 * bytes, and how it is authorised, are the profile's (`REQ-CP-1`).
 */
export interface AccessPass {
  /** The one ticket the pass designates (`REQ-AP-2`). */
  readonly ticket: TicketId;
  readonly holder: AccountId;
  /** Distinguishes this pass from every other for the same ticket (`REQ-AP-4`). */
  readonly id: PassId;
  /** The validity window (`REQ-AP-3`, `NFR-5`). */
  readonly notBefore: Timestamp;
  readonly notAfter: Timestamp;
}

/**
 * `validate_access_pass` (`US-E1`, `US-E3`): a pass with its holder's
 * authorisation. Any party may submit it (`REQ-OP-2`).
 */
export interface SignedAccessPass {
  readonly pass: AccessPass;
  readonly authorisation: Authorisation;
}

/** `can_attend`'s verdict. A refusal carries its reason (`REQ-Q-3`). */
export type AttendanceVerdict =
  | { readonly admit: true }
  | { readonly admit: false; readonly reason: TickettoErrorCode };

/** `getEvent`: an event by id. */
export interface GetEvent {
  readonly kind: "getEvent";
  readonly event: EventId;
}

/** `getTicket`: a ticket by id. */
export interface GetTicket {
  readonly kind: "getTicket";
  readonly ticket: TicketId;
}

/** `can_attend` (`REQ-Q-1`–`REQ-Q-4`): side-effect free. */
export interface CanAttend {
  readonly kind: "canAttend";
  readonly event: EventId;
  readonly ticket: TicketId;
}

/** The holder fixed for a ticket when its event was cancelled (`REQ-EV-10`). */
export interface GetCancellationHolder {
  readonly kind: "getCancellationHolder";
  readonly ticket: TicketId;
}

/**
 * The registration of one credential registered to an account (`REQ-CP-6`). A
 * verifier other than the ledger reads it here to check a holder's proof of
 * control: a registration obtained from anywhere else proves nothing.
 */
export interface GetCredential {
  readonly kind: "getCredential";
  readonly account: AccountId;
  readonly credential: CredentialId;
}

/** Every V0 query. Point lookups only: nothing enumerates (`REQ-MG-5`). */
export type Query = GetEvent | GetTicket | CanAttend | GetCancellationHolder | GetCredential;

/** What each query kind answers. */
export interface QueryResults {
  readonly getEvent: Event;
  readonly getTicket: Ticket;
  readonly canAttend: AttendanceVerdict;
  /** `null` while no holder has been fixed — the ticket's event is not `Cancelled`. */
  readonly getCancellationHolder: AccountId | null;
  /** `null` when the credential is not registered to the account, or the account does not exist. */
  readonly getCredential: Registration | null;
}

/** The answer to query `Q`. */
export type QueryResult<Q extends Query> = QueryResults[Q["kind"]];
