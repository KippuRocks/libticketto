// The backend port (C8) — features/002-sdk/plan.md §5.8.
//
// Signed commands and passes go in; submissions, query results, the log and the
// assurance declaration come out. A backend enforces nothing on a client's
// behalf: the rules run in the authority behind it (AD-25). Everything that
// crosses this port is named by the surface, never by the backend (REQ-SDK-2).

import type { AssuranceDeclaration } from "./assurance.js";
import type { SignedCommand } from "./capabilities.js";
import type { Query, QueryResult, SignedAccessPass } from "./commands.js";
import type { Sponsorship } from "./credentials.js";
import type { Result } from "./errors.js";
import type { Timestamp } from "./identifiers.js";
import type { LogReader } from "./log.js";
import type { Migration } from "./migration.js";
import type { Receipt, Submission } from "./submission.js";

/**
 * What crosses the port on a write: a signed command, or a signed access pass
 * with the time it was presented at the gate. `presentedAt` is claimed by the
 * submitter, and the rules bound it rather than trust it (`REQ-AP-3`); a
 * command never carries one.
 */
export type SubmitInput =
  | { readonly kind: "command"; readonly signed: SignedCommand }
  | {
      readonly kind: "pass";
      readonly signed: SignedAccessPass;
      readonly presentedAt: Timestamp;
    };

/** A ledger backend, as the SDK sees it. Swapping one changes nothing above this port (`REQ-SDK-1`). */
export interface Backend {
  /** Submits a signed command, or a signed access pass and when it was presented, with the sponsorship relaying it. */
  submit(input: SubmitInput, sponsorship?: Sponsorship): Submission<Receipt>;
  /** Answers a point query (`REQ-MG-5`). */
  query<Q extends Query>(query: Q): Promise<Result<QueryResult<Q>>>;
  /** The deployment's log (`REQ-SDK-5`). */
  readonly log: LogReader;
  /** Which invariants this backend enforces and which it attests (`REQ-SDK-6`). */
  readonly assurance: AssuranceDeclaration;
  /**
   * Export and import of complete ledger state (`REQ-MG-3`, plan §5.8a). Optional:
   * an operator's tool, used through `@ticketto/sdk/migration`.
   */
  readonly migration?: Migration;
}
