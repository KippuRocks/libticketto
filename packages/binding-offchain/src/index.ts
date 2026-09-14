// @ticketto/binding-offchain — the SDK binding to the hosted `ticketto-offchain`
// ledger service. Design: features/007-binding-offchain/plan.md in
// KippuRocks/kippu-docs; wire protocol: protocol/C4.md in
// KippuRocks/ticketto-offchain.

export {
  connectOffchainBackend,
  type OffchainBackend,
  type OffchainBackendOptions,
} from "./backend.js";
export {
  type AbortSignalLike,
  type BodyReaderLike,
  type C4Client,
  type C4ClientOptions,
  createC4Client,
  type FetchInit,
  type FetchLike,
  type FetchResponseLike,
  type HintStream,
  HintStreamClosed,
  HintStreamUnsupported,
  type HintsOutcome,
  type RequestOptions,
} from "./client.js";
export { HintParser, HintStreamDefect } from "./hints.js";
export {
  createOffchainLog,
  decodeRecord,
  type HintTransport,
  type OffchainLogOptions,
} from "./log.js";
export {
  createRetrier,
  DEFAULT_RETRY,
  LEDGER_UNAVAILABLE,
  type Retrier,
  type RetryBudget,
  type RetryOptions,
  type RetryPolicy,
  TIMED_OUT,
  type Timers,
} from "./retry.js";
export { C4Defect, createOffchainSubmit, type OffchainSubmitOptions } from "./submit.js";
export {
  type AssuranceOutcome,
  type CheckpointOutcome,
  type Defect,
  isLedgerCode,
  type LatestCheckpoint,
  type LogOutcome,
  type OperationOutcome,
  type QueryOutcome,
  type ReceivedResponse,
  type Rejected,
  type Resubmit,
  type Retry,
  type SubmitOutcome,
  translateAssurance,
  translateCheckpoint,
  translateHintsResponse,
  translateLog,
  translateOperation,
  translateQuery,
  translateSubmit,
  type Value,
  type WireLogEntry,
  type WireLogPage,
  type WireLogRecord,
} from "./translate.js";
export {
  codesRaisedByBinding,
  translateWireCode,
  UNAVAILABLE_CODE,
  WIRE_CODES,
  WIRE_TRANSLATION,
  type WireCode,
  type WireRow,
  type WireTranslation,
} from "./translation.js";
export {
  assuranceRequest,
  ENDPOINTS,
  type Endpoint,
  hintsRequest,
  isCursor,
  isOperationId,
  isSubmissionToken,
  type Json,
  LIMIT_MAX,
  latestCheckpointRequest,
  logRequest,
  MAX_BODY_BYTES,
  operationRequest,
  queryRequest,
  type SignedInputBytes,
  submitRequest,
  WAIT_DEFAULT,
  WAIT_MAX,
  type WireRequest,
} from "./wire.js";

export const packageName = "@ticketto/binding-offchain";
