import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AccessPass,
  AccountId,
  AttendanceVerdict,
  Authorisation,
  ClassId,
  Command,
  CommandKind,
  Event,
  EventId,
  IssueTicket,
  OperationEnvelope,
  OperationId,
  Query,
  QueryResult,
  Registration,
  SignedAccessPass,
  Ticket,
  TicketId,
  TickettoErrorCode,
  Timestamp,
} from "./index.js";

// SPEC.md §8.2, V0 rows only, mapped to their command type. validate_access_pass
// is submitted as a signed pass rather than signed as a command (plan §5.4).
interface V0Rows {
  create_event: Extract<Command, { kind: "createEvent" }>;
  set_event_status: Extract<Command, { kind: "setEventStatus" }>;
  set_event_capacity: Extract<Command, { kind: "setEventCapacity" }>;
  add_zone: Extract<Command, { kind: "addZone" }>;
  remove_zone: Extract<Command, { kind: "removeZone" }>;
  issue_ticket: Extract<Command, { kind: "issueTicket" }>;
  transfer_ticket: Extract<Command, { kind: "transferTicket" }>;
  validate_access_pass: SignedAccessPass;
  remove_restriction: Extract<Command, { kind: "removeRestriction" }>;
  register_credential: Extract<Command, { kind: "registerCredential" }>;
}

describe("commands (SPEC.md §8.2, plan §5.4)", () => {
  it("gives every V0 row of §8.2 a command type", () => {
    // `never` for a row means the union has no such kind.
    type Missing = {
      [Row in keyof V0Rows]: [V0Rows[Row]] extends [never] ? Row : never;
    }[keyof V0Rows];
    expectTypeOf<Missing>().toBeNever();
    expectTypeOf<keyof V0Rows>().toEqualTypeOf<
      | "create_event"
      | "set_event_status"
      | "set_event_capacity"
      | "add_zone"
      | "remove_zone"
      | "issue_ticket"
      | "transfer_ticket"
      | "validate_access_pass"
      | "remove_restriction"
      | "register_credential"
    >();
  });

  it("adds no beyond-V0 command", () => {
    expectTypeOf<CommandKind>().toEqualTypeOf<
      | "createEvent"
      | "setEventStatus"
      | "setEventCapacity"
      | "addZone"
      | "removeZone"
      | "issueTicket"
      | "transferTicket"
      | "removeRestriction"
      | "registerCredential"
    >();
  });

  it("carries an operation id and expiry on every signed command (REQ-CM-1)", () => {
    expectTypeOf<Command>().toExtend<OperationEnvelope>();
    expectTypeOf<OperationEnvelope>().toEqualTypeOf<{
      readonly operationId: OperationId;
      readonly expiresAt: Timestamp;
    }>();
  });

  it("gives issueTicket its policy, restrictions, and a required holder (amendment 0003)", () => {
    expectTypeOf<IssueTicket["holder"]>().toEqualTypeOf<AccountId>();
    expectTypeOf<IssueTicket["class"]>().toEqualTypeOf<ClassId>();
    expectTypeOf<IssueTicket["policy"]>().toEqualTypeOf<Ticket["policy"]>();
    expectTypeOf<IssueTicket["restrictions"]>().toEqualTypeOf<Ticket["restrictions"]>();
    expectTypeOf<IssueTicket["ticket"]>().toEqualTypeOf<TicketId>();
    // @ts-expect-error — a holder is not optional (INV-2).
    const withoutHolder: Omit<IssueTicket, "holder"> extends IssueTicket ? true : never = true;
    expect(withoutHolder).toBe(true);
  });

  it("lets removeRestriction only name a restriction field", () => {
    expectTypeOf<Extract<Command, { kind: "removeRestriction" }>["restriction"]>().toEqualTypeOf<
      "cannotResale" | "cannotTransfer"
    >();
  });

  it("keeps a registration and a pass authorisation opaque bytes", () => {
    expectTypeOf<
      Extract<Command, { kind: "registerCredential" }>["registration"]
    >().toEqualTypeOf<Registration>();
    expectTypeOf<Registration>().toExtend<Uint8Array>();
    expectTypeOf<SignedAccessPass["authorisation"]>().toEqualTypeOf<Authorisation>();
    expectTypeOf<keyof AccessPass>().toEqualTypeOf<
      "ticket" | "holder" | "id" | "notBefore" | "notAfter"
    >();
    // @ts-expect-error — a registration is not an authorisation.
    const confused: Authorisation = new Uint8Array() as Registration;
    expect(confused).toBeDefined();
  });
});

describe("queries (plan §5.5)", () => {
  it("answers each query with its own type", () => {
    expectTypeOf<QueryResult<{ kind: "getEvent"; event: EventId }>>().toEqualTypeOf<Event>();
    expectTypeOf<QueryResult<{ kind: "getTicket"; ticket: TicketId }>>().toEqualTypeOf<Ticket>();
    expectTypeOf<
      QueryResult<{ kind: "canAttend"; event: EventId; ticket: TicketId }>
    >().toEqualTypeOf<AttendanceVerdict>();
    expectTypeOf<
      QueryResult<{ kind: "getCancellationHolder"; ticket: TicketId }>
    >().toEqualTypeOf<AccountId | null>();
  });

  it("offers point lookups only — nothing enumerates (REQ-MG-5)", () => {
    expectTypeOf<Query["kind"]>().toEqualTypeOf<
      "getEvent" | "getTicket" | "canAttend" | "getCancellationHolder"
    >();
  });

  it("returns a reason on refusal, not merely false (REQ-Q-3)", () => {
    const refused: AttendanceVerdict = { admit: false, reason: "ERR-TicketExpired" };
    if (!refused.admit) expectTypeOf(refused.reason).toEqualTypeOf<TickettoErrorCode>();
    // @ts-expect-error — a refusal without a reason is not a verdict.
    const bare: AttendanceVerdict = { admit: false };
    expect([refused, bare]).toHaveLength(2);
  });
});
