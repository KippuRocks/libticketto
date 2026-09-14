// `addZone` and `removeZone` — features/008-ledger-rules/plan.md §5.2, §5.7a;
// SPEC.md REQ-ID-7.

import type { AddZone, RemoveZone } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";
import { activeCheck, existingEvent, ownerCheck } from "./common.js";

/**
 * Checks, in order: the signer owns the event (`ERR-NotOwner`); it is `Active`
 * (`ERR-EventSealed` / `ERR-EventCancelled`); the zone id is new in the event
 * (`ERR-ZoneExists`). The zone is added with its kind.
 */
export const addZone: CommandHandler<AddZone> = async ({ tx, command, signer, event }) => {
  const current = existingEvent(event);
  const refusal = ownerCheck(current, signer) ?? activeCheck(current);
  if (refusal !== null) return reject(refusal);
  if (current.zones.some((zone) => zone.id === command.zone.id)) {
    return reject(error("ERR-ZoneExists", `zone ${command.zone.id} exists`));
  }
  const zone = { id: command.zone.id, kind: command.zone.kind };
  return accept(async () => {
    await tx.putEvent({ ...current, zones: [...current.zones, zone] });
  });
};

/**
 * Checks, in order: the signer owns the event (`ERR-NotOwner`); the zone exists
 * in it (`ERR-UnknownZone`); no ticket has been issued in it (`ERR-ZoneInUse`).
 * The zone is removed.
 */
export const removeZone: CommandHandler<RemoveZone> = async ({ tx, command, signer, event }) => {
  const current = existingEvent(event);
  const refusal = ownerCheck(current, signer);
  if (refusal !== null) return reject(refusal);
  if (!current.zones.some((zone) => zone.id === command.zone)) {
    return reject(error("ERR-UnknownZone", `zone ${command.zone} is not defined for the event`));
  }
  if (current.zonesInUse.includes(command.zone)) {
    return reject(error("ERR-ZoneInUse", `a ticket has been issued in zone ${command.zone}`));
  }
  return accept(async () => {
    await tx.putEvent({
      ...current,
      zones: current.zones.filter((zone) => zone.id !== command.zone),
    });
  });
};
