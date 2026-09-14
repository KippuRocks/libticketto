// @ticketto/sdk — the Ticketto SDK surface (C1) and backend port (C8).
// Design: features/002-sdk/plan.md in KippuRocks/kippu-docs.

export type {
  AttendancePolicy,
  Event,
  EventStatus,
  Placement,
  Provenance,
  Ticket,
  TicketRestrictions,
  Zone,
  ZoneKind,
} from "./domain.js";
export type {
  AccountId,
  Brand,
  ClassId,
  Count,
  Discriminator,
  EventId,
  MetadataLocator,
  OperationId,
  PassId,
  Position,
  ProofId,
  TicketId,
  Timestamp,
  ZoneId,
} from "./identifiers.js";

export const packageName = "@ticketto/sdk";
