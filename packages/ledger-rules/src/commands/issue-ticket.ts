// `issueTicket` — features/008-ledger-rules/plan.md §5.2, §5.7a; SPEC.md US-B1–
// US-B3, US-B5, REQ-ID-1, REQ-ID-2, REQ-TK-2–REQ-TK-5, INV-4, INV-12–INV-14.

import type { IssueTicket, TicketRestrictions } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";
import { activeCheck, existingEvent, ownerCheck } from "./common.js";

/**
 * Checks, in order:
 * 1. the signer owns the event (`ERR-NotOwner`);
 * 2. the event is `Active` (`ERR-EventSealed` / `ERR-EventCancelled`);
 * 3. the zone is defined for the event (`ERR-UnknownZone`);
 * 4. the placement's kind is the zone's (`ERR-ZoneKindMismatch`);
 * 5. the `TicketId` is the profile's derivation from event, zone and placement
 *    (`ERR-IdentifierMismatch`, `REQ-ID-1`);
 * 6. no ticket has that id (`ERR-TicketIdExists`, `REQ-ID-2`);
 * 7. issuance stays within `maxCapacity`, when there is one (`ERR-CapacityExceeded`, `INV-4`);
 * 8. a `Purchased` ticket carries no restriction (`ERR-RestrictionNotPermitted`, `INV-12`).
 *
 * The ticket is recorded with its holder, class, provenance, policy and no
 * attendances, and `cannotTransfer` implies `cannotResale` (`REQ-TK-2`). The
 * event's `issued` count goes up by one, and its zone is recorded as in use
 * (plan §5.7a), in the same transaction.
 */
export const issueTicket: CommandHandler<IssueTicket> = async ({
  tx,
  profile,
  command,
  signer,
  event,
}) => {
  const current = existingEvent(event);
  const refusal = ownerCheck(current, signer) ?? activeCheck(current);
  if (refusal !== null) return reject(refusal);

  const zone = current.zones.find(({ id }) => id === command.zone);
  if (zone === undefined) {
    return reject(error("ERR-UnknownZone", `zone ${command.zone} is not defined for the event`));
  }
  if (zone.kind !== command.placement.kind) {
    return reject(
      error("ERR-ZoneKindMismatch", `a ${command.placement.kind} placement in a ${zone.kind} zone`),
    );
  }
  if (profile.ticketId(command.event, command.zone, command.placement) !== command.ticket) {
    return reject(
      error(
        "ERR-IdentifierMismatch",
        "the ticket id is not derived from its event, zone and placement",
      ),
    );
  }
  if ((await tx.getTicket(command.ticket)) !== null) {
    return reject(error("ERR-TicketIdExists", `ticket ${command.ticket} exists`));
  }
  if (current.maxCapacity !== null && current.issued >= current.maxCapacity) {
    return reject(
      error("ERR-CapacityExceeded", `${current.issued} of ${current.maxCapacity} issued`),
    );
  }
  const { cannotResale, cannotTransfer } = command.restrictions;
  if (command.provenance === "Purchased" && (cannotResale || cannotTransfer)) {
    return reject(
      error("ERR-RestrictionNotPermitted", "a purchased ticket carries no restriction"),
    );
  }

  const restrictions: TicketRestrictions = {
    cannotResale: cannotResale || cannotTransfer,
    cannotTransfer,
  };
  return accept(async () => {
    const inserted = await tx.insertTicket({
      id: command.ticket,
      event: command.event,
      holder: command.holder,
      class: command.class,
      provenance: command.provenance,
      zone: command.zone,
      placement: command.placement,
      policy: command.policy,
      restrictions,
      attendances: 0,
    });
    // Checked above, in the same serialisable transaction.
    if (inserted === "exists") throw new Error(`ticket ${command.ticket} appeared mid-transaction`);
    await tx.putEvent({
      ...current,
      issued: current.issued + 1,
      zonesInUse: current.zonesInUse.includes(command.zone)
        ? current.zonesInUse
        : [...current.zonesInUse, command.zone],
    });
  });
};
