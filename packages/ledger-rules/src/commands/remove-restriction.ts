// `removeRestriction` — features/008-ledger-rules/plan.md §5.2, §5.7a; SPEC.md
// REQ-TK-6, INV-10, AC-B3.4.

import type { RemoveRestriction, TicketRestrictions } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { existingEvent, existingTicket, ownerCheck } from "./common.js";

/**
 * The restrictions left once `restriction` is cleared. Clearing `cannotResale`
 * on a ticket that is also `cannotTransfer` clears both, because resale implies
 * transfer (`REQ-TK-2`); clearing `cannotTransfer` clears only that flag, since
 * `cannotResale` alone is valid (plan §5.7a).
 */
function cleared(
  restrictions: TicketRestrictions,
  restriction: RemoveRestriction["restriction"],
): TicketRestrictions {
  return restriction === "cannotTransfer"
    ? { ...restrictions, cannotTransfer: false }
    : { cannotResale: false, cannotTransfer: false };
}

/**
 * Checks: the signer owns the ticket's event (`ERR-NotOwner`). A `Finished`
 * event was refused before any handler (`INV-16`).
 *
 * The command only ever clears a flag (`INV-10`, `REQ-TK-6`): there is no way to
 * add one after issuance (`AC-B3.4`). Clearing a flag that is already clear is
 * accepted and changes nothing (plan §5.7a).
 */
export const removeRestriction: CommandHandler<RemoveRestriction> = async ({
  tx,
  command,
  signer,
  event,
  ticket,
}) => {
  const current = existingTicket(ticket);
  const refusal = ownerCheck(existingEvent(event), signer);
  if (refusal !== null) return reject(refusal);

  const next = cleared(current.restrictions, command.restriction);
  const changed =
    next.cannotResale !== current.restrictions.cannotResale ||
    next.cannotTransfer !== current.restrictions.cannotTransfer;
  return accept(async () => {
    if (changed) await tx.recordTicketFacts(current.id, { restrictions: next });
  });
};
