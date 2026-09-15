// `setEventCapacity` — features/008-ledger-rules/plan.md §5.2, §5.7; SPEC.md US-A6,
// REQ-EV-4–REQ-EV-8, INV-11.

import type { SetEventCapacity } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";
import { activeCheck, existingEvent, ownerCheck } from "./common.js";

/**
 * Checks, in order: the signer owns the event (`ERR-NotOwner`); it is `Active`
 * (`ERR-EventSealed` / `ERR-EventCancelled`, `REQ-EV-8`; `Finished` was refused
 * before any handler); the new capacity is not below `issued`
 * (`ERR-CapacityBelowIssuance`, `REQ-EV-4`, `INV-11`); an increase — raising the
 * bound, or removing it (`REQ-EV-7`) — carries a proof id
 * (`ERR-CapacityProofRequired`, `REQ-EV-5`).
 *
 * Lowering the bound, adding one to an unbounded event, or setting the same
 * capacity needs no proof. The proof id is recorded in the log entry — the
 * signed command itself — which is the ledger's record of which proof
 * authorised the increase (`REQ-EV-6`, plan §5.7).
 */
export const setEventCapacity: CommandHandler<SetEventCapacity> = async ({
  tx,
  command,
  signer,
  event,
}) => {
  const current = existingEvent(event);
  const refusal = ownerCheck(current, signer) ?? activeCheck(current);
  if (refusal !== null) return reject(refusal);

  const next = command.capacity;
  if (next !== null && next < current.issued) {
    return reject(
      error("ERR-CapacityBelowIssuance", `${current.issued} issued; capacity ${next} is below it`),
    );
  }
  const was = current.maxCapacity;
  const increase = was !== null && (next === null || next > was);
  if (increase && command.proof === null) {
    return reject(
      error("ERR-CapacityProofRequired", "an increase needs a validated capacity proof"),
    );
  }
  return accept(async () => {
    await tx.putEvent({ ...current, maxCapacity: next });
  });
};
