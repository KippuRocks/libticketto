// `submitAccessPass` — features/008-ledger-rules/plan.md §5.2, §5.6; SPEC.md
// US-E1, US-E3, REQ-AP-1–REQ-AP-4, INV-3, INV-5, INV-6, §7.E.
//
// A pass carries its holder's authorisation, so nobody signs its submission
// (REQ-OP-2). Its pass id is its operation id (AD-15). When it was presented is
// claimed by the submitter, and the rules bound that claim rather than trust it
// (§7.E's note).
//
// In order, inside one serialisable transaction:
//   0. the ticket exists                                 → ERR-TicketNotFound
//   -  an identical resubmission — same signed pass, same presentedAt — of a
//      consumed pass, up to notAfter plus the maximum recording lag, returns the
//      original receipt; an operation record under the pass id that is not this
//      pass's consumption                                → ERR-OperationConflict
//   1. the authorisation verifies, and its signer is the ticket's current
//      holder                                            → ERR-InvalidPass
//   2. the window is no longer than the maximum pass window; presentedAt is
//      within [notBefore, notAfter] and no more than the maximum
//      clock skew ahead of the clock; the clock is no later than notAfter plus
//      the maximum recording lag                         → ERR-PassExpired
//   3. the pass id is not consumed for the ticket        → ERR-PassReplayed
//   4. canAttend's order, with policy expiry judged at presentedAt
//   5. attendances goes up by exactly one; the pass id is recorded as consumed,
//      kept until notAfter plus the maximum recording lag.

import { blake2b256, encodeSignedAccessPass } from "@ticketto/profile-v0";
import type {
  OperationId,
  Profile,
  Receipt,
  Result,
  SignedAccessPass,
  Timestamp,
} from "@ticketto/sdk";
import { attendanceVerdict } from "./attendance.js";
import type { Capabilities, Registry, TicketRecord } from "./capabilities.js";
import type { Limits } from "./config.js";
import { bytesEqual, err, ok } from "./result.js";

/**
 * The operation digest of a pass submission (C3): BLAKE2b-256 of the profile's
 * signed-pass framing followed by `presentedAt` as u64 little-endian, so the
 * same pass presented at another time is a different submission (plan §5.2).
 */
export function passDigest(signed: SignedAccessPass, presentedAt: Timestamp): Uint8Array {
  const framing = encodeSignedAccessPass(signed);
  const bytes = new Uint8Array(framing.length + 8);
  bytes.set(framing);
  new DataView(bytes.buffer).setBigUint64(framing.length, BigInt(presentedAt), true);
  return blake2b256(bytes);
}

/** Step 1: the pass is authorised by a credential registered to the ticket's current holder. */
async function authorisedByHolder(
  tx: Registry,
  profile: Profile,
  signed: SignedAccessPass,
  ticket: TicketRecord,
): Promise<Result<void>> {
  const { pass, authorisation } = signed;
  const claimed = profile.accountOf(authorisation);
  if (!claimed.ok) return err("ERR-InvalidPass", claimed.error.detail);
  const { account, credential } = claimed.value;
  if (account !== pass.holder || account !== ticket.holder) {
    return err("ERR-InvalidPass", "the pass is not the ticket's current holder's");
  }
  const registered = (await tx.getRegistrations(account)).find((r) => r.credential === credential);
  if (registered === undefined) {
    return err("ERR-InvalidPass", "the credential is not registered to the holder");
  }
  if (!profile.verify(registered.registration, profile.encodePass(pass), authorisation)) {
    return err("ERR-InvalidPass", "the authorisation does not verify");
  }
  return ok(undefined);
}

/** Executes one signed access pass, presented at `presentedAt`. */
export async function submitAccessPass(
  caps: Capabilities,
  profile: Profile,
  signed: SignedAccessPass,
  presentedAt: Timestamp,
  limits: Limits,
): Promise<Result<Receipt>> {
  if (!Number.isSafeInteger(presentedAt) || presentedAt < 0) {
    throw new TypeError("presentedAt is a timestamp");
  }
  const { pass } = signed;
  const operationId = pass.id as string as OperationId;
  const retainUntil = pass.notAfter + limits.maxRecordingLag;
  const digest = passDigest(signed, presentedAt);

  return caps.transaction(async (tx): Promise<Result<Receipt>> => {
    const now = caps.clock.now();

    // 0. The ticket the pass designates exists (REQ-AP-2).
    const ticket = await tx.getTicket(pass.ticket);
    if (ticket === null) return err("ERR-TicketNotFound", `no ticket ${pass.ticket}`);

    // An identical resubmission, or an operation id taken by something else. A
    // record past its own expiry is treated as forgotten, as for commands.
    const recorded = await tx.getOperation(operationId);
    if (recorded !== null && now <= recorded.expiresAt) {
      if (bytesEqual(recorded.digest, digest)) return ok(recorded.receipt);
      if (!(await tx.isPassConsumed(pass.ticket, pass.id))) {
        return err("ERR-OperationConflict", "the pass id is recorded for a different operation");
      }
      // Otherwise a distinct submission of a consumed pass: step 3 refuses it.
    }

    // 1. Authorisation, by the current holder (REQ-AP-1).
    const authorised = await authorisedByHolder(tx, profile, signed, ticket);
    if (!authorised.ok) return authorised;

    // 2. The window (REQ-AP-3): bounded itself, and bounding the submitter's claim.
    if (pass.notAfter - pass.notBefore > limits.maxPassWindow) {
      return err("ERR-PassExpired", "the pass's window is longer than the ledger allows");
    }
    if (presentedAt < pass.notBefore || presentedAt > pass.notAfter) {
      return err("ERR-PassExpired", "presented outside the pass's window");
    }
    if (presentedAt > now + limits.maxClockSkew) {
      return err("ERR-PassExpired", "presented further ahead of the ledger's clock than it allows");
    }
    if (now > retainUntil) {
      return err("ERR-PassExpired", "recorded later than the maximum recording lag allows");
    }

    // 3. Single use (INV-6).
    if (await tx.isPassConsumed(pass.ticket, pass.id)) {
      return err("ERR-PassReplayed", "the pass has been consumed");
    }

    // 4. canAttend's order, with policy expiry judged at presentation (§7.E).
    const event = await tx.getEvent(ticket.event);
    if (event === null) throw new Error(`ticket ${ticket.id} of a missing event`);
    const verdict = attendanceVerdict(event, ticket, presentedAt);
    if (!verdict.admit) return err(verdict.reason);

    // 5. Exactly one attendance (INV-3, INV-5), and the pass consumed.
    await tx.recordTicketFacts(ticket.id, { attendances: ticket.attendances + 1 });
    await tx.recordConsumedPass(ticket.id, pass.id, retainUntil);
    const record = await tx.appendLog({
      recordedAt: now,
      event: ticket.event,
      entry: signed,
      presentedAt,
    });
    const receipt: Receipt = { operationId, cursor: record.cursor };
    await tx.recordOperation(operationId, { expiresAt: retainUntil, digest, receipt });
    return ok(receipt);
  });
}
