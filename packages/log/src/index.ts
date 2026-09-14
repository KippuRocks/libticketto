// @ticketto/log — the published log (C7): record and checkpoint formats, the
// hash chain, and their verification.
// Design: features/006-log-and-export/plan.md in KippuRocks/kippu-docs.

export { COMMAND_FIELDS, checkRecordContent, LogContentError } from "./allow-list.js";
export {
  type ChainFault,
  type ChainHead,
  type ChainState,
  type ChainVerification,
  EMPTY_CHAIN,
  type HeldCheckpoint,
  type LinkedRecord,
  LogChain,
  type LogEntry,
  linkRecord,
  verifyChain,
} from "./chain.js";
export {
  CHECKPOINT_SIGNING_TAG,
  CHECKPOINT_VERSION,
  type Checkpoint,
  type CheckpointStatement,
  checkpointSigningPayload,
  decodeCheckpoint,
  encodeCheckpoint,
  signCheckpoint,
  statementFor,
  verifyCheckpoint,
} from "./checkpoint.js";
export {
  type ChainedRecord,
  decodeRecord,
  type EventReference,
  encodeRecord,
  GENESIS_HASH,
  HASH_LENGTH,
  hashRecord,
  hashRecordBytes,
  type LogInput,
  RECORD_HASH_TAG,
  RECORD_VERSION,
} from "./record.js";
export { LogDecodeError } from "./scale.js";

export const packageName = "@ticketto/log";
