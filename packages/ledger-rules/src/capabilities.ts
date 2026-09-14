// The capability interfaces (C3) — features/008-ledger-rules/plan.md §5.1,
// SPEC.md REQ-SDK-3.
//
// What the ledger rules need from the store beneath them, in domain terms and
// nothing else. `backend-memory` (F-005) and `ticketto-offchain` (F-010) each
// implement these; the rules never learn which one they run over. No storage,
// transport or ledger-backend concept appears here (REQ-SDK-2), and nothing
// here verifies a signature: `Signatures` is the profile's capability, not the
// store's (REQ-CP-3).

import type {
  AccountId,
  Count,
  CredentialId,
  Event,
  EventId,
  LogRecord,
  OperationId,
  PassId,
  Receipt,
  Registration,
  Ticket,
  TicketId,
  TicketRestrictions,
  Timestamp,
} from "@ticketto/sdk";

/** A monotonic current timestamp agreed by all parties to the backend (`REQ-SDK-3`). */
export interface Clock {
  /** Never less than any value it returned before. */
  now(): Timestamp;
}

declare const beyondV0: unique symbol;

/**
 * Settles a stated price from buyer to seller, atomically with the change of
 * holder (`REQ-SDK-3`). Declared, and unused in V0: no V0 command settles value.
 *
 * Its members are deliberately absent, because what a price denominates is
 * open (`OQ-5`, `OQ-8`). Until they are declared nothing can implement it, so
 * no store offers a `Value` the rules would never call.
 */
export interface Value {
  readonly [beyondV0]: never;
}

/** A credential registered to an account (`REQ-CP-6`). */
export interface CredentialRegistration {
  readonly credential: CredentialId;
  /** Opaque to the store; only the profile reads it (`REQ-CP-3`). */
  readonly registration: Registration;
}

/** A ticket as the registry holds it: its §5.2 facts, plus the rules' own bookkeeping. */
export interface TicketRecord extends Ticket {
  /**
   * The holder fixed when the ticket's event was cancelled, recorded on the
   * ticket's first holder change after cancellation; `null` until then
   * (plan §5.5, `REQ-EV-10`).
   */
  readonly cancellationHolder: AccountId | null;
}

/** Ticket facts a command may record, besides its holder. Absent fields are left unchanged. */
export interface TicketFacts {
  /** Only ever incremented, by exactly one (`INV-3`, `INV-5`). */
  readonly attendances?: Count;
  /** Only ever cleared (`INV-10`). */
  readonly restrictions?: TicketRestrictions;
  /** Set once, and never changed afterwards (`REQ-EV-10`). */
  readonly cancellationHolder?: AccountId;
}

/** A recorded operation id, with what an identical replay returns (`REQ-CM-1`, plan §5.4). */
export interface OperationRecord {
  readonly expiresAt: Timestamp;
  /**
   * A digest of the signed input recorded under this id — BLAKE2b-256 of the
   * profile's signed-input framing. The rules compute it; the store only keeps
   * and returns it. The same id with the same digest is an identical replay,
   * answered with `receipt`; with a different digest, `ERR-OperationConflict`.
   */
  readonly digest: Uint8Array;
  readonly receipt: Receipt;
}

/**
 * A logical log record, as the rules emit it. The store gives it its place in
 * the deployment's total order and in its event's sequence, and chains it
 * (`F-006`); the rules never do.
 */
export interface LogAppend {
  /** By the capabilities' clock. */
  readonly recordedAt: Timestamp;
  /** The event the write concerns; `null` for a write no event owns. */
  readonly event: EventId | null;
  readonly entry: LogRecord["entry"];
  /**
   * When an access pass was presented, as its submitter claimed it; `null` for
   * a command. The store puts it in the record (`F-006` plan §5.1).
   */
  readonly presentedAt: Timestamp | null;
}

/**
 * The ledger's state, in the terms of SPEC.md §5 (`REQ-SDK-3`). Every lookup is
 * a point lookup: nothing enumerates (`REQ-MG-5`).
 *
 * The registry enforces no rule. It stores what it is told, and reports only
 * the one conflict a store can see — a ticket id already taken. Changing a
 * ticket that does not exist is a defect in the caller, and a store MAY throw.
 */
export interface Registry {
  /** An event by id, or `null` when none exists. */
  getEvent(id: EventId): Promise<Event | null>;
  /** Records an event, replacing any existing event with its id. */
  putEvent(event: Event): Promise<void>;

  /** The credentials registered to an account, in registration order; empty for an unknown account. */
  getRegistrations(account: AccountId): Promise<readonly CredentialRegistration[]>;
  /** Records a credential registered to an account (`REQ-CP-6`). */
  addRegistration(account: AccountId, registration: CredentialRegistration): Promise<void>;

  /** A ticket by id, or `null` when none exists. */
  getTicket(id: TicketId): Promise<TicketRecord | null>;
  /**
   * Records a new ticket, with no cancellation holder. Fails, changing nothing,
   * when a ticket with its id exists (`REQ-ID-1`).
   */
  insertTicket(ticket: Ticket): Promise<"inserted" | "exists">;
  /** Changes an existing ticket's holder. */
  setHolder(ticket: TicketId, holder: AccountId): Promise<void>;
  /** Records facts of an existing ticket. */
  recordTicketFacts(ticket: TicketId, facts: TicketFacts): Promise<void>;

  /**
   * Whether a pass id has been consumed for a ticket (`INV-6`). The store MAY
   * forget a consumed pass once its retention time has passed (`AD-13`,
   * plan §5.6).
   */
  isPassConsumed(ticket: TicketId, pass: PassId): Promise<boolean>;
  /** Records a pass id as consumed for a ticket, to be kept at least until `retainUntil`. */
  recordConsumedPass(ticket: TicketId, pass: PassId, retainUntil: Timestamp): Promise<void>;

  /**
   * A recorded operation id, or `null` when none is recorded. The store MAY
   * forget an operation once its expiry has passed (`AD-15`, plan §5.4).
   */
  getOperation(id: OperationId): Promise<OperationRecord | null>;
  /** Records an operation id, to be kept at least until its expiry. */
  recordOperation(id: OperationId, operation: OperationRecord): Promise<void>;

  /** Appends a logical log record, returning it as recorded, cursor and sequence included. */
  appendLog(record: LogAppend): Promise<LogRecord>;
}

/** The capabilities a store supplies to the ledger rules (`C3`). */
export interface Capabilities {
  /**
   * The registry outside any transaction, for reads that write nothing. The
   * rules write only inside `transaction`.
   */
  readonly registry: Registry;
  readonly clock: Clock;
  /** Beyond V0 (Epic C). */
  readonly value?: Value;
  /**
   * Runs `fn` in one serialisable transaction: concurrent transactions have the
   * effect of running one at a time, in some order (plan §5.1, `AC-E3.2`).
   *
   * When `fn` resolves, every write made through `tx` commits together, and
   * `transaction` resolves with its value. When `fn` rejects, none of them
   * commits, and `transaction` rejects with its reason.
   *
   * A store MAY run `fn` more than once — to retry after a serialisation
   * conflict — so `fn` must have no effect outside `tx`. `tx` must not be used
   * once `fn` has settled.
   */
  transaction<T>(fn: (tx: Registry) => Promise<T>): Promise<T>;
}
