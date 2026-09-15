// `transferTicket` — features/008-ledger-rules/plan.md §5.2, §5.5, §5.7; SPEC.md
// US-D1, INV-2, REQ-TK-4, REQ-EV-10, AC-A5.4.

import type { TransferTicket } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";
import { existingEvent, existingTicket } from "./common.js";

/**
 * Checks, in order: the signer is the ticket's holder (`ERR-NotOwner`); the
 * ticket is not `cannotTransfer` (`ERR-CannotTransfer`, `REQ-TK-4`). Nothing
 * encumbers a ticket in V0, so `ERR-TicketEncumbered` has nothing to read yet
 * (plan §5.7). A `Finished` event was refused before any handler (`INV-16`); a
 * `Sealed` or `Cancelled` event's ticket still transfers (`AC-A4.2`, `AC-A5.4`),
 * and a purchased ticket never carries the restriction (`INV-12`).
 *
 * The receiver becomes the one holder (`INV-2`). This is the one path that
 * changes a holder, so it takes the lazy snapshot (plan §5.5): when the event
 * is `Cancelled` and no cancellation holder is recorded yet, the holder before
 * this transfer is recorded first, and never changes afterwards (`REQ-EV-10`).
 */
export const transferTicket: CommandHandler<TransferTicket> = async ({
  tx,
  command,
  signer,
  event,
  ticket,
}) => {
  const current = existingTicket(ticket);
  const status = existingEvent(event).status;
  if (current.holder !== signer) {
    return reject(error("ERR-NotOwner", "the signer does not hold the ticket"));
  }
  if (current.restrictions.cannotTransfer) {
    return reject(error("ERR-CannotTransfer", "the ticket cannot be transferred"));
  }
  return accept(async () => {
    if (status === "Cancelled" && current.cancellationHolder === null) {
      await tx.recordTicketFacts(current.id, { cancellationHolder: current.holder });
    }
    await tx.setHolder(current.id, command.receiver);
  });
};
