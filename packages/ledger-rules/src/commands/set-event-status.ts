// `setEventStatus` — features/008-ledger-rules/plan.md §5.2; SPEC.md US-A4, US-A5,
// REQ-EV-11, REQ-EV-12.

import type { EventStatus, SetEventStatus } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";
import { existingEvent, ownerCheck } from "./common.js";

/**
 * The permitted transitions (`REQ-EV-11`): `Active → Sealed`, and
 * `Active | Sealed → Finished | Cancelled`. `Cancelled` and `Finished` are
 * terminal (`AC-A5.6`), and no status transitions to itself.
 */
const PERMITTED: { readonly [From in EventStatus]: readonly EventStatus[] } = {
  Active: ["Sealed", "Finished", "Cancelled"],
  Sealed: ["Finished", "Cancelled"],
  Cancelled: [],
  Finished: [],
};

/**
 * Checks, in order: the signer owns the event (`ERR-NotOwner`); the transition
 * is permitted (`ERR-InvalidTransition`). A `Finished` event was refused before
 * any handler (`INV-16`). Nothing on the ledger sets a status by time
 * (`REQ-EV-12`): only this command changes it.
 */
export const setEventStatus: CommandHandler<SetEventStatus> = async ({
  tx,
  command,
  signer,
  event,
}) => {
  const current = existingEvent(event);
  const refusal = ownerCheck(current, signer);
  if (refusal !== null) return reject(refusal);
  if (!PERMITTED[current.status].includes(command.status)) {
    return reject(
      error("ERR-InvalidTransition", `${current.status} cannot become ${command.status}`),
    );
  }
  return accept(async () => {
    await tx.putEvent({ ...current, status: command.status });
  });
};
