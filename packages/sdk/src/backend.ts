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
import type { LogReader } from "./log.js";
import type { Receipt, Submission } from "./submission.js";

/** A ledger backend, as the SDK sees it. Swapping one changes nothing above this port (`REQ-SDK-1`). */
export interface Backend {
  /** Submits a signed command, or a signed access pass, with the sponsorship relaying it. */
  submit(command: SignedCommand | SignedAccessPass, sponsorship?: Sponsorship): Submission<Receipt>;
  /** Answers a point query (`REQ-MG-5`). */
  query<Q extends Query>(query: Q): Promise<Result<QueryResult<Q>>>;
  /** The deployment's log (`REQ-SDK-5`). */
  readonly log: LogReader;
  /** Which invariants this backend enforces and which it attests (`REQ-SDK-6`). */
  readonly assurance: AssuranceDeclaration;
}
