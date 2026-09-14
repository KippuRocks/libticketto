// @ticketto/ledger-rules — the ledger's rules over the capability interfaces (C3).
// Design: features/008-ledger-rules/plan.md in KippuRocks/kippu-docs.

export type {
  Capabilities,
  Clock,
  CredentialRegistration,
  LogAppend,
  OperationRecord,
  Registry,
  TicketFacts,
  TicketRecord,
  Value,
} from "./capabilities.js";
export { type Execute, type ExecuteContext, execute } from "./execute.js";
export { query } from "./query.js";

export const packageName = "@ticketto/ledger-rules";
