import type {
  AccountId,
  Event,
  EventId,
  LogRecord,
  OperationId,
  PassId,
  Receipt,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Capabilities,
  Clock,
  LogAppend,
  OperationRecord,
  Registry,
  TicketRecord,
  Value,
} from "./index.js";

describe("C3 capability interfaces (REQ-SDK-3)", () => {
  it("supplies a registry, a clock, a transaction, and value only beyond V0", () => {
    expectTypeOf<keyof Capabilities>().toEqualTypeOf<
      "registry" | "clock" | "value" | "transaction"
    >();
    expectTypeOf<Capabilities["value"]>().toEqualTypeOf<Value | undefined>();
    expectTypeOf<Clock["now"]>().returns.toEqualTypeOf<Timestamp>();
  });

  it("declares Value, and nothing can implement it in V0", () => {
    // @ts-expect-error — Value has no members to implement until OQ-5 and OQ-8 are closed.
    const value: Value = {};
    expect(value).toBeDefined();
  });

  it("runs a transaction over the registry and returns its value", () => {
    expectTypeOf<Capabilities["transaction"]>()
      .parameter(0)
      .toEqualTypeOf<(tx: Registry) => Promise<unknown>>();
    const run = (caps: Capabilities) => caps.transaction(async () => 7);
    expectTypeOf(run).returns.toEqualTypeOf<Promise<number>>();
  });

  it("reads and writes events and tickets in domain terms", () => {
    expectTypeOf<Registry["getEvent"]>().toEqualTypeOf<(id: EventId) => Promise<Event | null>>();
    expectTypeOf<Registry["getTicket"]>().returns.toEqualTypeOf<Promise<TicketRecord | null>>();
    expectTypeOf<Registry["insertTicket"]>().parameter(0).toEqualTypeOf<Ticket>();
    expectTypeOf<Registry["insertTicket"]>().returns.toEqualTypeOf<
      Promise<"inserted" | "exists">
    >();
    expectTypeOf<TicketRecord["cancellationHolder"]>().toEqualTypeOf<AccountId | null>();
  });

  it("REQ-CM-1: records consumed passes with retention, and operations with expiry, digest and receipt", () => {
    expectTypeOf<Registry["recordConsumedPass"]>().parameters.toEqualTypeOf<
      [ticket: TicketId, pass: PassId, retainUntil: Timestamp]
    >();
    expectTypeOf<Registry["recordOperation"]>().parameters.toEqualTypeOf<
      [id: OperationId, operation: OperationRecord]
    >();
    expectTypeOf<OperationRecord>().toEqualTypeOf<{
      readonly expiresAt: Timestamp;
      readonly digest: Uint8Array;
      readonly receipt: Receipt;
    }>();
  });

  it("appends logical log records; the store assigns cursor and sequence", () => {
    expectTypeOf<keyof LogAppend>().toEqualTypeOf<
      "recordedAt" | "event" | "entry" | "presentedAt"
    >();
    expectTypeOf<LogAppend["entry"]>().toEqualTypeOf<LogRecord["entry"]>();
    expectTypeOf<LogAppend["presentedAt"]>().toEqualTypeOf<LogRecord["presentedAt"]>();
    expectTypeOf<Registry["appendLog"]>().returns.toEqualTypeOf<Promise<LogRecord>>();
  });
});
