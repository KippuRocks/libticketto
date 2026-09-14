// `createEvent` — features/008-ledger-rules/plan.md §5.2; SPEC.md US-A1,
// REQ-EV-3, REQ-EV-9, REQ-ID-7.

import type { CreateEvent } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";

/**
 * Checks, in order: the `EventId` is the profile's derivation from the signer
 * and salt (`ERR-IdentifierMismatch`); no event has it (`ERR-EventIdExists`);
 * zone ids are unique (`ERR-ZoneExists`). The event is recorded `Active`, owned
 * by the signer, with nothing issued. A `null` capacity leaves issuance
 * unbounded (`REQ-EV-3`).
 */
export const createEvent: CommandHandler<CreateEvent> = async ({
  tx,
  profile,
  command,
  signer,
  event,
}) => {
  if (profile.eventId(signer, command.salt) !== command.event) {
    return reject(
      error("ERR-IdentifierMismatch", "the event id is not derived from the signer and salt"),
    );
  }
  if (event !== null) {
    return reject(error("ERR-EventIdExists", `event ${command.event} exists`));
  }
  const seen = new Set<string>();
  for (const zone of command.zones) {
    if (seen.has(zone.id)) {
      return reject(error("ERR-ZoneExists", `zone ${zone.id} is named twice`));
    }
    seen.add(zone.id);
  }
  return accept(async () => {
    await tx.putEvent({
      id: command.event,
      owner: signer,
      status: "Active",
      maxCapacity: command.capacity,
      issued: 0,
      zones: command.zones.map(({ id, kind }) => ({ id, kind })),
    });
  });
};
