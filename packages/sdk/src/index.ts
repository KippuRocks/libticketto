// @ticketto/sdk — the Ticketto SDK surface (C1) and backend port (C8).
// Design: features/002-sdk/plan.md in KippuRocks/kippu-docs.

export type {
  AccessPass,
  AddZone,
  AttendanceVerdict,
  CanAttend,
  Command,
  CommandKind,
  CreateEvent,
  GetCancellationHolder,
  GetEvent,
  GetTicket,
  IssueTicket,
  OperationEnvelope,
  Query,
  QueryResult,
  QueryResults,
  RegisterCredential,
  RemoveRestriction,
  RemoveZone,
  Restriction,
  SetEventCapacity,
  SetEventStatus,
  SignedAccessPass,
  TransferTicket,
} from "./commands.js";
export type { Authorisation, Registration } from "./credentials.js";
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
export type { Result, TickettoError } from "./errors.js";
export {
  type ErrorOrigin,
  INVARIANT_IDS,
  type InvariantId,
  TICKETTO_ERROR_CODES,
  TICKETTO_ERROR_ORIGINS,
  type TickettoErrorCode,
} from "./generated/spec.js";
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
