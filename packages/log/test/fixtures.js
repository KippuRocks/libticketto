// Deterministic sample inputs for the log's tests: one signed command of every
// V0 kind, and a signed access pass. Keys are fixed, and p256 signing is
// deterministic, so the same inputs come out on every run.
import { encodeCommand, eventId, producePass, ticketId } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";

function filled(length, byte) {
  return new Uint8Array(length).fill(byte);
}
function hex(length, byte) {
  return byte.toString(16).padStart(2, "0").repeat(length);
}
export const organiser = softwareP256Signer({ secretKey: filled(32, 0x11) });
export const holder = softwareP256Signer({ secretKey: filled(32, 0x22) });
export const salt = filled(16, 0x5a);
export const event = eventId(organiser.signer.account, salt);
export const zone = hex(32, 0x7a);
export const placement = { kind: "Unseated", discriminator: hex(16, 0xd1) };
export const ticket = ticketId(event, zone, placement);
const envelope = (n) => ({
  operationId: hex(16, n),
  expiresAt: 1_900_000_000_000 + n,
});
/** One command of every V0 kind, in the SDK's order. */
export const COMMANDS = {
  createEvent: {
    kind: "createEvent",
    ...envelope(1),
    event,
    salt,
    zones: [{ id: zone, kind: "Unseated" }],
    capacity: 100,
    metadata: "kippu://events/sample",
  },
  setEventStatus: { kind: "setEventStatus", ...envelope(2), event, status: "Sealed" },
  setEventCapacity: {
    kind: "setEventCapacity",
    ...envelope(3),
    event,
    capacity: 200,
    proof: "c0ffee",
  },
  addZone: {
    kind: "addZone",
    ...envelope(4),
    event,
    zone: { id: hex(32, 0x7b), kind: "Seated" },
  },
  removeZone: { kind: "removeZone", ...envelope(5), event, zone: hex(32, 0x7b) },
  issueTicket: {
    kind: "issueTicket",
    ...envelope(6),
    event,
    ticket,
    zone,
    placement,
    class: "0a0b",
    provenance: "Granted",
    policy: { kind: "Multiple", max: 3, until: null },
    restrictions: { cannotResale: true, cannotTransfer: false },
    holder: holder.signer.account,
    metadata: null,
  },
  transferTicket: {
    kind: "transferTicket",
    ...envelope(7),
    event,
    ticket,
    receiver: hex(32, 0x99),
  },
  removeRestriction: {
    kind: "removeRestriction",
    ...envelope(8),
    event,
    ticket,
    restriction: "cannotResale",
  },
  registerCredential: {
    kind: "registerCredential",
    ...envelope(9),
    account: holder.signer.account,
    registration: holder.registration,
  },
};
export async function signCommand(command) {
  const signer = command.kind === "registerCredential" ? holder.signer : organiser.signer;
  return { command, authorisation: await signer.sign(encodeCommand(command)) };
}
export async function samplePass() {
  return producePass(
    { ticket, holder: holder.signer.account, notBefore: 1_800_000_000_000, id: hex(16, 0xab) },
    holder.signer,
  );
}
/** The event reference a record of `input` carries, at `sequence` in that event. */
export function eventOf(input, sequence) {
  if ("pass" in input) return { id: event, sequence };
  return "event" in input.command ? { id: input.command.event, sequence } : null;
}
//# sourceMappingURL=fixtures.js.map
