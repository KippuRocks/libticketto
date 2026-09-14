import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type Backend,
  type Cursor,
  LOG_START,
  type LogPage,
  type LogReader,
  type LogRecord,
  type Receipt,
  type Result,
  type SignedAccessPass,
  type SignedCommand,
  type Timestamp,
} from "./index.js";

describe("the log reader (REQ-SDK-5, AD-17)", () => {
  it("types hints() to carry cursors only", () => {
    expectTypeOf<ReturnType<LogReader["hints"]>>().toEqualTypeOf<AsyncIterable<Cursor>>();
    const leaky: Pick<LogReader, "hints"> = {
      // @ts-expect-error — a hint must not carry records.
      async *hints() {
        yield {} as LogRecord;
      },
    };
    expect(leaky).toBeDefined();
  });

  it("pulls records by cursor, a page at a time", () => {
    expectTypeOf<LogReader["read"]>().parameters.toEqualTypeOf<[from: Cursor, limit: number]>();
    expectTypeOf<ReturnType<LogReader["read"]>>().toEqualTypeOf<Promise<Result<LogPage>>>();
    expectTypeOf<LogPage["next"]>().toEqualTypeOf<Cursor>();
  });

  it("records the write as submitted, never a backend concept", () => {
    expectTypeOf<keyof LogRecord>().toEqualTypeOf<
      "cursor" | "recordedAt" | "event" | "entry" | "presentedAt"
    >();
    expectTypeOf<LogRecord["entry"]>().toEqualTypeOf<SignedCommand | SignedAccessPass>();
  });

  it("carries a pass's claimed presentedAt, and null for a command (C7 alignment)", () => {
    expectTypeOf<LogRecord["presentedAt"]>().toEqualTypeOf<Timestamp | null>();
  });

  it("starts the log at an opaque cursor", () => {
    expectTypeOf(LOG_START).toEqualTypeOf<Cursor>();
    expect(LOG_START).toBe("");
  });

  it("joins the backend port, and a receipt names its record's cursor", () => {
    expectTypeOf<Backend["log"]>().toEqualTypeOf<LogReader>();
    expectTypeOf<Receipt["cursor"]>().toEqualTypeOf<Cursor>();
    // @ts-expect-error — a cursor is not a plain string.
    const cursor: Cursor = "42";
    expect(cursor).toBe("42");
  });
});
