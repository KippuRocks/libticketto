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
  DEFAULT_MAX_CLOCK_SKEW,
  DEFAULT_MAX_OPERATION_LIFETIME,
  DEFAULT_MAX_PASS_WINDOW,
  DEFAULT_MAX_RECORDING_LAG,
  type RulesConfig,
} from "./config.js";
export { configureExecute, type Execute, type ExecuteContext, execute } from "./execute.js";
export { query } from "./query.js";

export const packageName = "@ticketto/ledger-rules";
