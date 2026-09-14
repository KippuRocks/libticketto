// Identifiers and scalar values of the SDK surface — features/002-sdk/plan.md §5.1.
//
// Every identifier is a branded string: the lower-case hex of the canonical
// bytes the cryptographic profile defines for it. Strings cross JSON and tRPC
// untouched; the brand stops one kind of identifier being passed where another
// is expected. How the bytes are produced is the profile's concern
// (REQ-CP-1, REQ-CP-2), never a backend's (REQ-SDK-2, REQ-MG-2).

declare const brand: unique symbol;

/** `T` tagged with a compile-time-only name, so that differently named brands never mix. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Identifies an event. Derived by the Ticketto layer, never allocated by a backend (`REQ-EV-9`). */
export type EventId = Brand<string, "EventId">;

/** Identifies a ticket. Determined solely by event, zone and placement (`REQ-ID-1`, `INV-13`). */
export type TicketId = Brand<string, "TicketId">;

/** Identifies a zone within its event (`REQ-ID-7`). */
export type ZoneId = Brand<string, "ZoneId">;

/** Identifies a ticket class. Opaque: the class itself is a Kippu concept (`REQ-TC-2`). */
export type ClassId = Brand<string, "ClassId">;

/** Identifies an account — an organiser, a holder, or any other party (§4.6). */
export type AccountId = Brand<string, "AccountId">;

/** Distinguishes one access pass from every other pass for the same ticket (`REQ-AP-4`). */
export type PassId = Brand<string, "PassId">;

/** Identifies one submitted command, so that a replay is rejected or a no-op (`REQ-CM-1`). */
export type OperationId = Brand<string, "OperationId">;

/** Identifies the validated capacity proof that authorised an increase (`REQ-EV-5`, `REQ-EV-6`). */
export type ProofId = Brand<string, "ProofId">;

/** A seat designation within a seated zone (§5.5). */
export type Position = Brand<string, "Position">;

/** Distinguishes a placement within an unseated zone; unique within its zone (`REQ-ID-5`). */
export type Discriminator = Brand<string, "Discriminator">;

/** Milliseconds since the Unix epoch. */
export type Timestamp = number;

/** A count: a non-negative safe integer. No bit width is implied (§5 preamble). */
export type Count = number;

/** A stable location identifier resolving to Kippu-hosted metadata (`REQ-MD-1`, `AD-22`). */
export type MetadataLocator = string;
