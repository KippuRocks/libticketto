// @ticketto/ledger-rules — the ledger's rules over the capability interfaces (C3).
// Design: features/008-ledger-rules/plan.md in KippuRocks/kippu-docs.

export type {
  Capabilities,
  Clock,
  CredentialRegistration,
  EventRecord,
  LogAppend,
  OperationRecord,
  Registry,
  TicketFacts,
  TicketRecord,
  Value,
} from "./capabilities.js";
export {
  configureExecute,
  DEFAULT_MAX_OPERATION_LIFETIME,
  type Execute,
  type ExecuteContext,
  execute,
  type RulesConfig,
} from "./execute.js";
export { query } from "./query.js";

export const packageName = "@ticketto/ledger-rules";
