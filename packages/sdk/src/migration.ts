// Migration — features/002-sdk/plan.md §5.8a, REQ-MG-3, REQ-MG-5.
//
// Exporting complete ledger state and importing it into another backend is an
// operator's tool, not an application's, so it sits on its own entry point,
// `@ticketto/sdk/migration`, and a backend offers it through an optional port
// member. A chain binding provides it from its own state export rather than
// through application queries, which never enumerate (REQ-MG-5).
//
// The stream is F-006's export format (C7): the SDK carries its chunks as
// opaque bytes and never reads them. Verifying an import against the export is
// F-006's driver, through the port alone.
//
// Nothing here is a ledger operation, so failures are not errors of SPEC.md
// §10: they are a `MigrationResult` with a typed reason.

import type { Backend } from "./backend.js";

/** Why a migration step did not happen. */
export type MigrationFailureReason =
  /** The backend offers no `migration` member. */
  | "unsupported"
  /** Import was asked of a backend that already holds ledger state; import accepts only an empty one. */
  | "notEmpty"
  /** The stream is not a well-formed export, or its parts disagree with one another. */
  | "malformed";

/** A migration step that did not happen, and why. */
export interface MigrationFailure {
  readonly ok: false;
  readonly reason: MigrationFailureReason;
  /** Human-readable context. Never a backend's own error, identifier or concept (`REQ-SDK-2`). */
  readonly detail?: string;
}

/** The outcome of an import. */
export type MigrationResult = { readonly ok: true } | MigrationFailure;

/** The outcome of starting an export: the stream, or why there is none. */
export type MigrationExport =
  | { readonly ok: true; readonly stream: AsyncIterable<Uint8Array> }
  | MigrationFailure;

/**
 * A backend's export and import of complete ledger state (`REQ-MG-3`). Optional
 * on `Backend`: an operator's tool, not an application's.
 */
export interface Migration {
  /** The ledger's complete state, as a stream of `F-006`'s export format. */
  export(): AsyncIterable<Uint8Array>;
  /**
   * Loads an exported stream into this backend, which must be empty: the
   * exported log records verbatim, at the same sequences and with the same
   * hashes, then the state snapshot (`F-006` §5.5).
   */
  import(stream: AsyncIterable<Uint8Array>): Promise<MigrationResult>;
}

/** Exports `backend`'s complete ledger state, or fails with `unsupported` when it offers no migration. */
export function exportLedger(backend: Backend): MigrationExport {
  const { migration } = backend;
  if (migration === undefined) return unsupported();
  return { ok: true, stream: migration.export() };
}

/**
 * Imports an exported stream into `backend`, which must be empty. Fails with
 * `unsupported` when the backend offers no migration, and otherwise with
 * whatever reason the backend gives. Verifying the result against the export
 * is `F-006`'s driver.
 */
export async function importLedger(
  backend: Backend,
  stream: AsyncIterable<Uint8Array>,
): Promise<MigrationResult> {
  const { migration } = backend;
  if (migration === undefined) return unsupported();
  return migration.import(stream);
}

function unsupported(): MigrationFailure {
  return { ok: false, reason: "unsupported", detail: "the backend offers no migration" };
}
