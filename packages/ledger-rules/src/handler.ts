// Command handlers — features/008-ledger-rules/plan.md §5.2 (step 5), §5.7.
//
// A handler performs its command's own checks before any write, and answers
// with the error they produced or the writes that accept the command.

import type {
  AccountId,
  Command,
  CommandKind,
  Event,
  Profile,
  TickettoError,
  Timestamp,
} from "@ticketto/sdk";
import type { Registry, TicketRecord } from "./capabilities.js";

/** What a command's handler sees, once the checks common to every command have passed. */
export interface CommandContext<C extends Command> {
  readonly tx: Registry;
  readonly profile: Profile;
  readonly command: C;
  /** The account whose registered credential authorised the command (step 3). */
  readonly signer: AccountId;
  /**
   * The event the command names, as recorded; `null` only for a command that
   * names an event yet to exist (`createEvent`), or none (`registerCredential`).
   */
  readonly event: Event | null;
  /** The existing ticket the command names; `null` when it names none. */
  readonly ticket: TicketRecord | null;
  /** The capabilities' clock, read once for the whole input. */
  readonly now: Timestamp;
}

/** A handler's answer: the error its checks produced, or the writes that accept the command. */
export type CommandOutcome =
  | { readonly accepted: false; readonly error: TickettoError }
  | { readonly accepted: true; readonly apply: () => Promise<void> };

/** A command's own checks and writes (plan §5.2, step 5). Performs no write before it answers. */
export type CommandHandler<C extends Command> = (
  context: CommandContext<C>,
) => Promise<CommandOutcome>;

/** One handler per command kind. */
export type CommandHandlers = {
  readonly [K in CommandKind]: CommandHandler<Extract<Command, { kind: K }>>;
};

/** Rejects a command with an error of §10. */
export function reject(error: TickettoError): CommandOutcome {
  return { accepted: false, error };
}

/** Accepts a command with the writes `apply` performs. */
export function accept(apply: () => Promise<void>): CommandOutcome {
  return { accepted: true, apply };
}
