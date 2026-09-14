// The C8 backend port over C4 — T-007-03 with T-007-02; F-007 §1, §5; REQ-SDK-1.
//
// `connectOffchainBackend` is to `ticketto-offchain` what `createMemoryBackend` is
// to the in-memory ledger: the one `Backend` the SDK sees. It submits and reads;
// it enforces nothing (AD-25).
//
// Connecting reads the assurance declaration once. The port exposes it as a
// plain property (`Backend.assurance`), and a deployment's declaration does not
// change while it runs (REQ-SDK-6, C4.md §3.6).

import type { AssuranceDeclaration, Backend, Query, QueryResult, Result } from "@ticketto/sdk";
import { type C4Client, createC4Client, type FetchLike } from "./client.js";
import { createOffchainLog, type HintTransport } from "./log.js";
import {
  createRetrier,
  LEDGER_UNAVAILABLE,
  type Retrier,
  type RetryPolicy,
  type Timers,
} from "./retry.js";
import { C4Defect, createOffchainSubmit } from "./submit.js";

export interface OffchainBackendOptions {
  /** The service's base URL. */
  readonly url: string;
  /** Defaults to the platform's `fetch`. */
  readonly fetch?: FetchLike;
  readonly retry?: Partial<RetryPolicy>;
  /** Defaults to the platform's timers. */
  readonly timers?: Timers;
  /** How long the service may hold each long-poll of a submission, in milliseconds (C4.md §3.2). */
  readonly wait?: number;
  /**
   * How long a request may take before it is abandoned and retried, in
   * milliseconds — beyond `wait`, for a long-poll (C4.md §3.2: at least 10 s).
   */
  readonly timeoutMargin?: number;
  /** How log hints arrive: `events` on Node, `poll` on React Native; `auto` by default. */
  readonly hints?: HintTransport;
  /** How often hints poll the head, when they poll, in milliseconds. */
  readonly pollInterval?: number;
}

/** A backend over `ticketto-offchain`. */
export type OffchainBackend = Backend;

/** The pieces a backend is built from, shared with the test controls. */
export interface OffchainParts {
  readonly client: C4Client;
  readonly retrier: Retrier;
  readonly timeout: number;
}

export function offchainParts(options: OffchainBackendOptions): OffchainParts {
  const client = createC4Client({
    url: options.url,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const retrier = createRetrier({
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
  });
  return { client, retrier, timeout: options.timeoutMargin ?? 10_000 };
}

/** The port over `parts`, with the declaration read when connecting. */
export function backendOver(
  options: OffchainBackendOptions,
  parts: OffchainParts,
  assurance: AssuranceDeclaration,
): OffchainBackend {
  const { client, retrier, timeout } = parts;
  const submit = createOffchainSubmit({
    client,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    timeoutMargin: timeout,
  });
  const log = createOffchainLog({
    client,
    retrier,
    timeout,
    ...(options.hints === undefined ? {} : { hints: options.hints }),
    ...(options.pollInterval === undefined ? {} : { pollInterval: options.pollInterval }),
  });

  return {
    submit,
    async query<Q extends Query>(query: Q): Promise<Result<QueryResult<Q>>> {
      const outcome = await retrier.read(
        (signal) => client.query(query, signal === undefined ? {} : { signal }),
        timeout,
      );
      switch (outcome.outcome) {
        case "value":
          return outcome.value;
        case "unavailable":
          return { ok: false, error: LEDGER_UNAVAILABLE };
        case "defect":
          // C4.md §4.3: a read that meets a defect throws.
          throw new C4Defect(outcome.reason);
        default:
          throw new C4Defect("an unmapped query outcome");
      }
    },
    log,
    assurance,
  };
}

/** Reads the deployment's assurance declaration (C4.md §3.6). */
export async function readAssurance(parts: OffchainParts): Promise<Result<AssuranceDeclaration>> {
  const { client, retrier, timeout } = parts;
  const outcome = await retrier.read(
    (signal) => client.assurance(signal === undefined ? {} : { signal }),
    timeout,
  );
  switch (outcome.outcome) {
    case "value":
      return { ok: true, value: outcome.value };
    case "unavailable":
      return { ok: false, error: LEDGER_UNAVAILABLE };
    case "defect":
      throw new C4Defect(outcome.reason);
    default:
      throw new C4Defect("an unmapped assurance outcome");
  }
}

/**
 * Connects to a `ticketto-offchain` deployment: reads its assurance declaration,
 * and answers the port over it. `ERR-LedgerUnavailable` when the service cannot
 * be reached within the retry budget.
 */
export async function connectOffchainBackend(
  options: OffchainBackendOptions,
): Promise<Result<OffchainBackend>> {
  const parts = offchainParts(options);
  const assurance = await readAssurance(parts);
  if (!assurance.ok) return assurance;
  return { ok: true, value: backendOver(options, parts, assurance.value) };
}
