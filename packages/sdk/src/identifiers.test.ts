import { describe, expectTypeOf, it } from "vitest";
import type {
  AccountId,
  ClassId,
  Discriminator,
  EventId,
  OperationId,
  PassId,
  Position,
  ProofId,
  TicketId,
  ZoneId,
} from "./index.js";

// Type-level tests: `pnpm typecheck` compiles this file, so every
// `@ts-expect-error` below must still be an error or the check fails.

const eventId = "00" as EventId;
const ticketId = "00" as TicketId;

function takesTicketId(id: TicketId): TicketId {
  return id;
}

describe("branded identifiers", () => {
  it("refuses an EventId where a TicketId is expected", () => {
    // @ts-expect-error — an EventId is not a TicketId.
    takesTicketId(eventId);
    expectTypeOf(takesTicketId(ticketId)).toEqualTypeOf<TicketId>();
  });

  it("refuses a plain string where an identifier is expected", () => {
    // @ts-expect-error — a string is not branded.
    takesTicketId("00");
  });

  it("is still usable as a string", () => {
    expectTypeOf<EventId>().toExtend<string>();
  });

  it("keeps every identifier distinct from every other", () => {
    type Ids = [
      EventId,
      TicketId,
      ZoneId,
      ClassId,
      AccountId,
      PassId,
      OperationId,
      ProofId,
      Position,
      Discriminator,
    ];
    type Mixable<T extends unknown[]> = {
      [I in keyof T]: {
        [J in keyof T]: I extends J ? never : T[I] extends T[J] ? [I, J] : never;
      }[number];
    }[number];
    expectTypeOf<Mixable<Ids>>().toBeNever();
  });
});
