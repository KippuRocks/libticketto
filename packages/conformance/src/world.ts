// A fresh world for one test: an empty backend, the SDK over it, and the
// fixtures' credentials registered — features/004-conformance/plan.md §5.1.

import {
  createTicketto,
  type Profile,
  type Receipt,
  type Signer,
  type Submission,
  type Ticketto,
} from "@ticketto/sdk";
import type {
  ConformanceIdentifiers,
  ConformanceSigners,
  ConformanceTarget,
  Credential,
  TestBackend,
} from "./harness.js";

/** How long every command the suite assembles stays valid, in milliseconds (`AD-15`). */
export const OPERATION_LIFETIME = 60_000;

/** The state every conformance test starts from. */
export interface World {
  readonly backend: TestBackend;
  /** The SDK over `backend`, on the backend's clock and seeded randomness. */
  readonly ticketto: Ticketto;
  readonly profile: Profile;
  readonly signers: ConformanceSigners;
  readonly identifiers: ConformanceIdentifiers;
  /** The organiser's signer: registered. */
  readonly organiser: Signer;
  /** The holders' signers: registered. */
  readonly holders: readonly Signer[];
}

/** An error in the harness or a fixture, not in the backend's behaviour. */
export class HarnessError extends Error {
  override name = "HarnessError";
}

/** Makes a fresh world for `target`, registering the organiser and every holder. */
export async function createWorld(target: ConformanceTarget): Promise<World> {
  const { signers, profile } = target;
  if (signers.holders.length < 3) {
    throw new HarnessError(`${target.name}: the signer fixtures need at least three holders`);
  }
  const backend = await target.makeBackend();
  const ticketto = createTicketto({
    backend,
    profile,
    sponsor: signers.sponsor,
    operationLifetime: OPERATION_LIFETIME,
    now: () => backend.clock.now(),
    randomBytes: (length) => backend.randomBytes(length),
  });

  for (const [role, credential] of [
    ["organiser", signers.organiser],
    ...signers.holders.map((holder, i) => [`holder ${i}`, holder] as const),
  ] as const) {
    const result = await register(ticketto, credential);
    if (!result.ok) {
      throw new HarnessError(
        `${target.name}: registering the ${role}'s credential failed with ${result.error.code}`,
      );
    }
  }

  return {
    backend,
    ticketto,
    profile,
    signers,
    identifiers: target.identifiers,
    organiser: signers.organiser.signer,
    holders: signers.holders.map((holder) => holder.signer),
  };
}

/** Registers `credential` to its own account, signed by itself (`REQ-CP-6`). */
export function register(ticketto: Ticketto, credential: Credential): Submission<Receipt> {
  return ticketto.registerCredential(credential.signer, {
    account: credential.signer.account,
    registration: credential.registration,
  });
}
