// The C8 port over the ledger rules — T-005-02, features/005-backend-memory/plan.md §5.2.
//
// `ledger-rules` runs in-process, behind the port, over the in-memory
// capabilities (AD-25): a client submits, and the rules enforce. A submission
// reports `submitted` before `submit` returns, and settles only after at least
// one turn of the microtask queue, never synchronously — a client that works
// only because settlement is immediate fails against this backend too, not
// first against the network (NFR-9).

import { type Clock, execute, query } from "@ticketto/ledger-rules";
import {
  type Backend,
  createSubmission,
  type Migration,
  type OperationId,
  type Profile,
  type Query,
  type QueryResult,
  type Receipt,
  type Result,
  type Signer,
  type Submission,
  type SubmitInput,
} from "@ticketto/sdk";
import { MEMORY_ASSURANCE } from "./assurance.js";
import { createMemoryStore, type MemoryStore } from "./capabilities.js";
import { createLogReader } from "./log.js";
import { memoryMigration } from "./migration.js";

/** Options for {@link createMemoryBackend}. */
export interface MemoryBackendOptions {
  /** The cryptographic profile the rules verify authorisations and derive identifiers with. */
  readonly profile: Profile;
  /** The ledger's clock (`REQ-SDK-3`). Defaults to the system clock, held monotonic. */
  readonly clock?: Clock;
  /**
   * The deployment's publication key, which signs an export's checkpoint
   * (`C7` §4). Without one, exporting a non-empty log throws.
   */
  readonly publication?: Signer;
}

/** The in-memory backend: the port, always with its `migration` member (`REQ-MG-3`). */
export interface MemoryBackend extends Backend {
  readonly migration: Migration;
}

/** The operation id a submission reports: a command's own, or a pass's id (`AD-15`, `AD-13`). */
function operationIdOf(input: SubmitInput): OperationId {
  return input.kind === "command"
    ? input.signed.command.operationId
    : (input.signed.pass.id as string as OperationId);
}

/**
 * The in-memory reference backend (`REQ-MG-1`), behind the port every backend
 * implements (`REQ-SDK-1`).
 *
 * A sponsorship is accepted and not verified: verifying one is the hosted
 * ledger service's concern (`F-010`), not the rules'.
 */
export function createMemoryBackend(options: MemoryBackendOptions): MemoryBackend {
  const { profile, clock, publication } = options;
  return backendOver(createMemoryStore(clock === undefined ? {} : { clock }), profile, publication);
}

/**
 * The port over a given store. Not exported from the package: whoever holds the
 * store's capabilities can write ledger state around the rules (`REQ-SDK-9`).
 */
export function backendOver(
  store: MemoryStore,
  profile: Profile,
  publication?: Signer,
): MemoryBackend {
  const caps = store.capabilities;
  const migration = memoryMigration(
    store,
    publication === undefined ? { clock: caps.clock } : { clock: caps.clock, publication },
  );

  return {
    submit(input: SubmitInput): Submission<Receipt> {
      const controller = createSubmission();
      controller.submitted(operationIdOf(input));
      (async () => {
        // Settle on a later microtask, whatever the rules do.
        await Promise.resolve();
        const result =
          input.kind === "command"
            ? await execute(caps, profile, input.signed)
            : await execute(caps, profile, input.signed, { presentedAt: input.presentedAt });
        if (result.ok) controller.settled(result.value);
        else controller.rejected(result.error);
      })().catch((reason: unknown) => controller.failed(reason));
      return controller.submission;
    },

    query<Q extends Query>(q: Q): Promise<Result<QueryResult<Q>>> {
      return query(caps, profile, q);
    },

    log: createLogReader(store),

    assurance: MEMORY_ASSURANCE,

    migration,
  };
}
