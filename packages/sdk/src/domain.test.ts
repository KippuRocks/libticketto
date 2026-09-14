import { describe, expectTypeOf, it } from "vitest";
import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Count,
  Event,
  EventId,
  EventStatus,
  Placement,
  Provenance,
  Ticket,
  TicketId,
  ZoneId,
  ZoneKind,
} from "./index.js";

describe("domain types (SPEC.md §5, V0 fields)", () => {
  it("names the four event statuses of §5.1", () => {
    expectTypeOf<EventStatus>().toEqualTypeOf<"Active" | "Sealed" | "Cancelled" | "Finished">();
  });

  it("gives an event exactly its V0 fields", () => {
    expectTypeOf<keyof Event>().toEqualTypeOf<
      "id" | "owner" | "status" | "maxCapacity" | "issued" | "zones"
    >();
    expectTypeOf<Event["maxCapacity"]>().toEqualTypeOf<Count | null>();
  });

  it("gives a ticket exactly its V0 fields — no listing, no pending claim", () => {
    expectTypeOf<keyof Ticket>().toEqualTypeOf<
      | "id"
      | "event"
      | "holder"
      | "class"
      | "provenance"
      | "zone"
      | "placement"
      | "policy"
      | "restrictions"
      | "attendances"
    >();
    expectTypeOf<Ticket["id"]>().toEqualTypeOf<TicketId>();
    expectTypeOf<Ticket["event"]>().toEqualTypeOf<EventId>();
    expectTypeOf<Ticket["holder"]>().toEqualTypeOf<AccountId>();
    expectTypeOf<Ticket["class"]>().toEqualTypeOf<ClassId>();
    expectTypeOf<Ticket["zone"]>().toEqualTypeOf<ZoneId>();
  });

  it("uses the spec's canonical restriction names, in camelCase (REQ-TK-1)", () => {
    expectTypeOf<keyof Ticket["restrictions"]>().toEqualTypeOf<"cannotResale" | "cannotTransfer">();
  });

  it("matches placement kinds to zone kinds", () => {
    expectTypeOf<Placement["kind"]>().toEqualTypeOf<ZoneKind>();
  });

  it("names both provenances and all three attendance policies", () => {
    expectTypeOf<Provenance>().toEqualTypeOf<"Purchased" | "Granted">();
    expectTypeOf<AttendancePolicy["kind"]>().toEqualTypeOf<"Single" | "Multiple" | "Unlimited">();
  });
});
