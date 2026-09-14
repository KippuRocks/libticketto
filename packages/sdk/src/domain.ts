// The V0 domain types of SPEC.md §5 — features/002-sdk/plan.md §5.2.
//
// Field names follow the spec, in camelCase (§5 preamble binds names, not
// widths). Only V0 fields appear: listings and pending claims serve
// beyond-V0 stories. An `Option<T>` in the spec is `T | null` here, always
// present, so that a value survives JSON unchanged.

import type {
  AccountId,
  ClassId,
  Count,
  Discriminator,
  EventId,
  Position,
  TicketId,
  Timestamp,
  ZoneId,
} from "./identifiers.js";

/** An event's lifecycle status (§5.1). Transitions are those of `REQ-EV-11`. */
export type EventStatus = "Active" | "Sealed" | "Cancelled" | "Finished";

/** Whether a zone's tickets are placed by position or by discriminator (§5.5). */
export type ZoneKind = "Seated" | "Unseated";

/** A zone of an event: its identity and kind are ledger facts (`REQ-ID-7`). */
export interface Zone {
  readonly id: ZoneId;
  readonly kind: ZoneKind;
}

/** A ticket's placement within its zone; its kind must match the zone's (`REQ-ID-7`). */
export type Placement =
  | { readonly kind: "Seated"; readonly position: Position }
  | { readonly kind: "Unseated"; readonly discriminator: Discriminator };

/** An event as the ledger records it (§5.1). */
export interface Event {
  readonly id: EventId;
  /** The organiser. */
  readonly owner: AccountId;
  readonly status: EventStatus;
  /** Bounds issuance when present; `null` means issuance is unbounded (`REQ-EV-3`). */
  readonly maxCapacity: Count | null;
  /** The number of tickets issued. */
  readonly issued: Count;
  readonly zones: readonly Zone[];
}

/** How a ticket entered circulation (§5.2). Immutable (`INV-14`). */
export type Provenance = "Purchased" | "Granted";

/** How many times, and until when, a ticket admits its holder (§5.2). */
export type AttendancePolicy =
  | { readonly kind: "Single" }
  | { readonly kind: "Multiple"; readonly max: Count; readonly until: Timestamp | null }
  | { readonly kind: "Unlimited"; readonly until: Timestamp | null };

/** A ticket's restrictions (§5.2, `REQ-TK-1`). Only granted tickets may carry any (`INV-12`). */
export interface TicketRestrictions {
  readonly cannotResale: boolean;
  readonly cannotTransfer: boolean;
}

/** A ticket as the ledger records it (§5.2). */
export interface Ticket {
  readonly id: TicketId;
  readonly event: EventId;
  readonly holder: AccountId;
  readonly class: ClassId;
  readonly provenance: Provenance;
  readonly zone: ZoneId;
  readonly placement: Placement;
  readonly policy: AttendancePolicy;
  readonly restrictions: TicketRestrictions;
  /** Monotonically non-decreasing (`INV-3`). */
  readonly attendances: Count;
}
