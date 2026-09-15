// `execute` — features/008-ledger-rules/plan.md §5.1, §5.2, §5.4, §5.7.
//
// Given the ledger's state and a signed input, accept it with its effects or
// reject it with a named error of SPEC.md §10. Everything one input does — every
// read, check, write, log record and operation record — happens inside one
// serialisable transaction, and commits together or not at all.
//
// The checks every signed command passes, in order (plan §5.2):
//   0. the event and ticket it names exist         → ERR-EventNotFound /
//      (createEvent names an event yet to exist)      ERR-TicketNotFound
//   1. its envelope has not expired, nor expires further ahead than the
//      maximum operation lifetime                  → ERR-OperationExpired
//   2. its operation id is not recorded            → an identical replay returns
//      the original receipt; a different command    → ERR-OperationConflict
//   3. its authorisation verifies against a credential registered to the
//      signing account                             → ERR-InvalidAuthorisation
//   4. the event it names is not Finished          → ERR-EventFinished (INV-16)
//   5. the command's own checks, in its handler.
//
// A transaction commits when its function resolves (plan §5.7), and the store
// cannot see a `Result`. So a handler performs every check before any write: it
// answers with an error, or with the writes that accept the command. Nothing is
// written for a rejected command, and a write that throws rolls back the lot.

import { blake2b256, encodeSignedCommand } from "@ticketto/profile-v0";
import type {
  AccountId,
  Command,
  CommandKind,
  EventId,
  Profile,
  Receipt,
  Result,
  SignedAccessPass,
  SignedCommand,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";
import type { Capabilities, Registry } from "./capabilities.js";
import { createEvent } from "./commands/create-event.js";
import { issueTicket } from "./commands/issue-ticket.js";
import { registerCredential } from "./commands/register-credential.js";
import { setEventCapacity } from "./commands/set-event-capacity.js";
import { setEventStatus } from "./commands/set-event-status.js";
import { transferTicket } from "./commands/transfer-ticket.js";
import { addZone, removeZone } from "./commands/zones.js";
import { type RulesConfig, resolveLimits } from "./config.js";
import type { CommandHandler, CommandHandlers } from "./handler.js";
import { submitAccessPass } from "./pass.js";
import { bytesEqual, err, ok } from "./result.js";

/** What accompanies an input besides its own bytes. */
export interface ExecuteContext {
  /**
   * When an access pass was presented at the gate, as its submitter claims it.
   * Passes only: a command carries none. The rules bound it, never trust it
   * (plan §5.2, `REQ-AP-3`).
   */
  readonly presentedAt?: Timestamp;
}

/** Executes one signed input against the capabilities, with the profile in force. */
export type Execute = (
  caps: Capabilities,
  profile: Profile,
  input: SignedCommand | SignedAccessPass,
  context?: ExecuteContext,
) => Promise<Result<Receipt>>;

function isSignedCommand(input: SignedCommand | SignedAccessPass): input is SignedCommand {
  return "command" in input;
}

/** The event a command names, if any; the event whose log sequence records it. */
function namedEvent(command: Command): EventId | null {
  return "event" in command ? command.event : null;
}

/** The existing ticket a command names, if any. `issueTicket` names one yet to exist. */
function namedTicket(command: Command): TicketId | null {
  return command.kind === "transferTicket" || command.kind === "removeRestriction"
    ? command.ticket
    : null;
}

/**
 * Step 3: the account an authorisation speaks for, provided it verifies against
 * a credential registered to that account (`REQ-CP-6`). The payload verified is
 * the profile's signing payload for the command, never bytes framed here.
 *
 * The one exception is an account's first registration: no credential is
 * registered yet, so the new credential authorises its own registration. The
 * registration must name the account and the credential that signed, and the
 * authorisation must verify against it (plan §5.2, `registerCredential`).
 */
async function authorise(
  tx: Registry,
  profile: Profile,
  signed: SignedCommand,
): Promise<Result<AccountId>> {
  const { command, authorisation } = signed;
  const claimed = profile.accountOf(authorisation);
  if (!claimed.ok) return err("ERR-InvalidAuthorisation", claimed.error.detail);
  const { account, credential } = claimed.value;
  const registrations = await tx.getRegistrations(account);
  const payload = profile.encodeCommand(command);

  if (
    command.kind === "registerCredential" &&
    command.account === account &&
    registrations.length === 0
  ) {
    const named = profile.registrationAccount(command.registration);
    if (!named.ok) return err("ERR-InvalidAuthorisation", named.error.detail);
    if (named.value.account !== account || named.value.credential !== credential) {
      return err(
        "ERR-InvalidAuthorisation",
        "a first registration is authorised by the credential it registers",
      );
    }
    if (!profile.verify(command.registration, payload, authorisation)) {
      return err("ERR-InvalidAuthorisation", "the authorisation does not verify");
    }
    return ok(account);
  }

  const registered = registrations.find((r) => r.credential === credential);
  if (registered === undefined) {
    return err("ERR-InvalidAuthorisation", "the credential is not registered to the account");
  }
  if (!profile.verify(registered.registration, payload, authorisation)) {
    return err("ERR-InvalidAuthorisation", "the authorisation does not verify");
  }
  return ok(account);
}

/** `execute` over a given set of command handlers and configuration. */
export function createExecute(handlers: CommandHandlers, config: RulesConfig = {}): Execute {
  const limits = resolveLimits(config);
  const maxLifetime = limits.maxOperationLifetime;
  return async (caps, profile, input, context = {}) => {
    if (!isSignedCommand(input)) {
      if (context.presentedAt === undefined) {
        throw new TypeError("an access pass is submitted with the time it was presented");
      }
      return submitAccessPass(caps, profile, input, context.presentedAt, limits);
    }
    if (context.presentedAt !== undefined) {
      throw new TypeError("a command carries no presentedAt; only an access pass does");
    }
    const signed = input;
    const { command } = signed;
    // The operation digest (C3): BLAKE2b-256 of the profile's signed-input framing.
    const digest = blake2b256(encodeSignedCommand(signed));

    return caps.transaction(async (tx): Promise<Result<Receipt>> => {
      const now = caps.clock.now();

      // 0. What the command names exists (§10, amendment 0003). A command against
      // a named event or ticket checks it first (plan §5.2).
      const eventId = namedEvent(command);
      const event = eventId === null ? null : await tx.getEvent(eventId);
      if (event === null && eventId !== null && command.kind !== "createEvent") {
        return err("ERR-EventNotFound", `no event ${eventId}`);
      }
      const ticketId = namedTicket(command);
      const ticket = ticketId === null ? null : await tx.getTicket(ticketId);
      // A ticket of another event does not exist in the event named (INV-1, plan §5.7a).
      if (ticketId !== null && (ticket === null || ticket.event !== eventId)) {
        return err("ERR-TicketNotFound", `no ticket ${ticketId} in event ${eventId}`);
      }

      // 1. The envelope.
      if (now > command.expiresAt) {
        return err("ERR-OperationExpired", `expired at ${command.expiresAt}`);
      }
      if (command.expiresAt - now > maxLifetime) {
        return err(
          "ERR-OperationExpired",
          `expires more than ${maxLifetime} ms ahead of the authority's clock`,
        );
      }

      // 2. Replay (plan §5.4). A record past its own expiry is one the store MAY
      // already have forgotten (C3), so it is treated as forgotten here too, and
      // the outcome never depends on the store's housekeeping.
      const recorded = await tx.getOperation(command.operationId);
      if (recorded !== null && now <= recorded.expiresAt) {
        if (bytesEqual(recorded.digest, digest)) return ok(recorded.receipt);
        return err("ERR-OperationConflict", "the operation id is recorded for a different command");
      }

      // 3. Authorisation.
      const authorised = await authorise(tx, profile, signed);
      if (!authorised.ok) return authorised;

      // 4. INV-16: nothing of a Finished event changes.
      if (event?.status === "Finished") {
        return err("ERR-EventFinished", "the event is Finished");
      }

      // 5. The command's own checks, then its writes.
      const handler = handlers[command.kind] as CommandHandler<Command>;
      const outcome = await handler({
        tx,
        profile,
        command,
        signer: authorised.value,
        event,
        ticket,
        now,
      });
      if (!outcome.accepted) return { ok: false, error: outcome.error };
      await outcome.apply();

      // The log record and the operation record, in the same transaction.
      const record = await tx.appendLog({
        recordedAt: now,
        event: eventId,
        entry: signed,
        presentedAt: null,
      });
      const receipt: Receipt = { operationId: command.operationId, cursor: record.cursor };
      await tx.recordOperation(command.operationId, {
        expiresAt: command.expiresAt,
        digest,
        receipt,
      });
      return ok(receipt);
    });
  };
}

function notImplemented(kind: CommandKind, task: string): CommandHandler<Command> {
  return async () => {
    throw new Error(`${kind} is not implemented yet (${task})`);
  };
}

/** The V0 command handlers. */
export const handlers: CommandHandlers = {
  createEvent,
  setEventStatus,
  setEventCapacity,
  addZone,
  removeZone,
  issueTicket,
  transferTicket,
  removeRestriction: notImplemented("removeRestriction", "T-008-12"),
  registerCredential,
};

/**
 * Executes one signed command or signed access pass (plan §5.1). An accepted
 * input settles with its receipt; a rejected one with an error of §10, having
 * changed nothing. A defect — an input no rule can judge — throws.
 */
export const execute: Execute = createExecute(handlers);

/** `execute` under the given configuration, for an authority that sets its own. */
export function configureExecute(config: RulesConfig): Execute {
  return createExecute(handlers, config);
}
