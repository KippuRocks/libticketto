// The Ticketto client — features/002-sdk/plan.md §5.4, §5.5, §5.7.
//
// `createTicketto` assembles commands, derives their identifiers through the
// profile, wraps them in the operation envelope, has them signed and
// sponsored, and submits them through the backend port. It enforces nothing:
// the rules run in the authority behind the backend (AD-25).

import type { AssuranceDeclaration } from "./assurance.js";
import type { Backend, SubmitInput } from "./backend.js";
import type { Profile, Signer, Sponsor } from "./capabilities.js";
import type {
  AttendanceVerdict,
  Command,
  CommandKind,
  OperationEnvelope,
  SignedAccessPass,
} from "./commands.js";
import type { Event, Ticket } from "./domain.js";
import type { Result } from "./errors.js";
import type { AccountId, EventId, OperationId, TicketId, Timestamp } from "./identifiers.js";
import type { LogReader } from "./log.js";
import { createSubmission, type Receipt, type Submission } from "./submission.js";

/** The fields a caller supplies for a command: everything but its kind, envelope, and derived id. */
export type CommandInput<Kind extends CommandKind> = Omit<
  Extract<Command, { kind: Kind }>,
  | "kind"
  | keyof OperationEnvelope
  | (Kind extends "createEvent" ? "event" : never)
  | (Kind extends "issueTicket" ? "ticket" : never)
>;

/** How an access pass was presented, as its submitter claims it. */
export interface PassPresentation {
  /** When the pass was presented at the gate. Bounded by the rules, not trusted (`REQ-AP-3`). */
  readonly presentedAt: Timestamp;
}

/** A write that derived an identifier, with the submission recording it. */
export interface Derived<Id> {
  readonly id: Id;
  readonly submission: Submission<Receipt>;
}

export interface TickettoOptions {
  readonly backend: Backend;
  readonly profile: Profile;
  /** Relays and bears the cost of every signed command and access pass (`REQ-SP-1`). */
  readonly sponsor: Sponsor;
  /** How long an assembled command stays valid, in milliseconds (`AD-15`). */
  readonly operationLifetime: number;
  /** The current time. Defaults to `Date.now`. */
  readonly now?: () => Timestamp;
  /** Random bytes for operation ids. Defaults to `crypto.getRandomValues` where the platform has it. */
  readonly randomBytes?: (length: number) => Uint8Array;
}

/** The SDK surface (`C1`): the same under every backend (`REQ-SDK-1`). */
export interface Ticketto {
  /** `US-A1`. The event's id is derived from the signer's account and `salt` (`REQ-EV-9`). */
  createEvent(signer: Signer, input: CommandInput<"createEvent">): Derived<EventId>;
  setEventStatus(signer: Signer, input: CommandInput<"setEventStatus">): Submission<Receipt>;
  setEventCapacity(signer: Signer, input: CommandInput<"setEventCapacity">): Submission<Receipt>;
  addZone(signer: Signer, input: CommandInput<"addZone">): Submission<Receipt>;
  removeZone(signer: Signer, input: CommandInput<"removeZone">): Submission<Receipt>;
  /** `US-B1`–`US-B5`. The ticket's id is derived from event, zone and placement (`REQ-ID-1`). */
  issueTicket(signer: Signer, input: CommandInput<"issueTicket">): Derived<TicketId>;
  transferTicket(signer: Signer, input: CommandInput<"transferTicket">): Submission<Receipt>;
  removeRestriction(signer: Signer, input: CommandInput<"removeRestriction">): Submission<Receipt>;
  registerCredential(
    signer: Signer,
    input: CommandInput<"registerCredential">,
  ): Submission<Receipt>;
  /**
   * `US-E1`, `US-E3`. The pass carries its holder's authorisation; nobody else signs
   * (`REQ-OP-2`). It is sponsored as a command is (`REQ-SP-1`), and submitted with
   * the time it was presented at the gate.
   */
  submitAccessPass(pass: SignedAccessPass, presentation: PassPresentation): Submission<Receipt>;

  getEvent(event: EventId): Promise<Result<Event>>;
  getTicket(ticket: TicketId): Promise<Result<Ticket>>;
  canAttend(event: EventId, ticket: TicketId): Promise<Result<AttendanceVerdict>>;
  getCancellationHolder(ticket: TicketId): Promise<Result<AccountId | null>>;
  assurance(): AssuranceDeclaration;
  readonly log: LogReader;
}

/** Operation ids carry 128 random bits, as access pass ids do (`AD-15`, `AD-13`). */
const OPERATION_ID_BYTES = 16;

export function createTicketto(options: TickettoOptions): Ticketto {
  const { backend, profile, sponsor, operationLifetime } = options;
  const now = options.now ?? (() => Date.now());
  const randomBytes = options.randomBytes ?? platformRandomBytes;

  const envelope = (): OperationEnvelope => ({
    operationId: hex(randomBytes(OPERATION_ID_BYTES)) as OperationId,
    expiresAt: now() + operationLifetime,
  });

  /** Sponsors a signed command or pass, then submits it with that sponsorship (`REQ-SP-1`). */
  const relay = async (
    input: SubmitInput,
    controller: ReturnType<typeof createSubmission>,
  ): Promise<void> => {
    const sponsorship = await sponsor.sponsor(input.signed);
    if (!sponsorship.ok) {
      controller.rejected(sponsorship.error);
      return;
    }
    await forward(backend.submit(input, sponsorship.value), controller);
  };

  const write = (signer: Signer, command: Command): Submission<Receipt> => {
    const controller = createSubmission();
    (async () => {
      const authorisation = await signer.sign(profile.encodeCommand(command));
      await relay({ kind: "command", signed: { command, authorisation } }, controller);
    })().catch((reason: unknown) => controller.failed(reason));
    return controller.submission;
  };

  return {
    createEvent(signer, input) {
      const id = profile.eventId(signer.account, input.salt);
      const submission = write(signer, { ...input, kind: "createEvent", ...envelope(), event: id });
      return { id, submission };
    },
    setEventStatus: (signer, input) =>
      write(signer, { ...input, kind: "setEventStatus", ...envelope() }),
    setEventCapacity: (signer, input) =>
      write(signer, { ...input, kind: "setEventCapacity", ...envelope() }),
    addZone: (signer, input) => write(signer, { ...input, kind: "addZone", ...envelope() }),
    removeZone: (signer, input) => write(signer, { ...input, kind: "removeZone", ...envelope() }),
    issueTicket(signer, input) {
      const id = profile.ticketId(input.event, input.zone, input.placement);
      const submission = write(signer, {
        ...input,
        kind: "issueTicket",
        ...envelope(),
        ticket: id,
      });
      return { id, submission };
    },
    transferTicket: (signer, input) =>
      write(signer, { ...input, kind: "transferTicket", ...envelope() }),
    removeRestriction: (signer, input) =>
      write(signer, { ...input, kind: "removeRestriction", ...envelope() }),
    registerCredential: (signer, input) =>
      write(signer, { ...input, kind: "registerCredential", ...envelope() }),
    submitAccessPass(pass, { presentedAt }) {
      const controller = createSubmission();
      relay({ kind: "pass", signed: pass, presentedAt }, controller).catch((reason: unknown) =>
        controller.failed(reason),
      );
      return controller.submission;
    },

    getEvent: (event) => backend.query({ kind: "getEvent", event }),
    getTicket: (ticket) => backend.query({ kind: "getTicket", ticket }),
    canAttend: (event, ticket) => backend.query({ kind: "canAttend", event, ticket }),
    getCancellationHolder: (ticket) => backend.query({ kind: "getCancellationHolder", ticket }),
    assurance: () => backend.assurance,
    log: backend.log,
  };
}

/** Relays a backend's submission into one this client returned. */
async function forward(
  from: Submission<Receipt>,
  to: ReturnType<typeof createSubmission>,
): Promise<void> {
  let submitted = false;
  for await (const state of from) {
    switch (state.state) {
      case "submitted":
        if (!submitted) to.submitted(state.operationId);
        submitted = true;
        break;
      case "settled":
        to.settled(state.receipt);
        return;
      case "rejected":
        to.rejected(state.error);
        return;
    }
  }
  const result = await from;
  if (result.ok) to.settled(result.value);
  else to.rejected(result.error);
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function platformRandomBytes(length: number): Uint8Array {
  const crypto = (globalThis as { crypto?: { getRandomValues(array: Uint8Array): Uint8Array } })
    .crypto;
  if (crypto === undefined) {
    throw new Error("No platform source of random bytes; pass `randomBytes` to createTicketto");
  }
  return crypto.getRandomValues(new Uint8Array(length));
}
