/// <reference types="node" />

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type AccountId,
  type Authorisation,
  type Backend,
  type Cursor,
  createSubmission,
  type EventId,
  type OperationId,
  type Receipt,
  type Result,
  type SignedAccessPass,
  type SignedCommand,
  type Sponsorship,
  type Submission,
  type SubmissionState,
  type TickettoError,
} from "./index.js";

// NFR-9: a scripted fake backend that accepts a write at once and settles it
// `latency` milliseconds later. The same test body runs at 1 ms and at 60 s,
// on fake timers, so CI does not wait a minute.

type Script = "settle" | "settle-without-submitted" | "reject";

const rejection: TickettoError = { code: "ERR-EventSealed" };

function scriptedBackend(latency: number, script: Script): Backend {
  return {
    submit(input: SignedCommand | SignedAccessPass) {
      const { submission, submitted, settled, rejected } = createSubmission();
      const operationId =
        "command" in input ? input.command.operationId : (input.pass.id as string as OperationId);
      if (script !== "settle-without-submitted") setTimeout(() => submitted(operationId), 0);
      setTimeout(() => {
        if (script === "reject") rejected(rejection);
        else settled({ operationId, cursor: `after-${operationId}` as Cursor });
      }, latency);
      return submission;
    },
    async query() {
      return { ok: false, error: { code: "ERR-LedgerUnavailable" } };
    },
    log: {
      async read(from) {
        return { ok: true, value: { records: [], next: from } };
      },
      async *hints() {},
    },
  };
}

const operationId = "0f".repeat(16) as OperationId;
const receipt: Receipt = { operationId, cursor: `after-${operationId}` as Cursor };
const signed: SignedCommand = {
  command: {
    kind: "setEventStatus",
    operationId,
    expiresAt: 0,
    event: "ee".repeat(32) as EventId,
    status: "Sealed",
  },
  authorisation: new Uint8Array([1]) as Authorisation,
};

async function collect(submission: Submission<Receipt>): Promise<SubmissionState[]> {
  const states: SubmissionState[] = [];
  for await (const state of submission) states.push(state);
  return states;
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["1 ms", 1],
  ["60 s", 60_000],
])("NFR-9: a backend at %s", (_, latency) => {
  it("presents a write identically, awaited or iterated, early or late", async () => {
    const submission = scriptedBackend(latency, "settle").submit(signed);
    let result: Result<Receipt> | undefined;
    void Promise.resolve(submission).then((r) => {
      result = r;
    });
    const early = collect(submission);

    await vi.advanceTimersByTimeAsync(latency - 1);
    expect(result).toBeUndefined();

    await vi.runAllTimersAsync();
    const expected: SubmissionState[] = [
      { state: "submitted", operationId },
      { state: "settled", receipt },
    ];
    expect(result).toEqual({ ok: true, value: receipt });
    expect(await submission).toEqual(result);
    expect(await early).toEqual(expected);
    expect(await collect(submission)).toEqual(expected);
    expect(Date.now()).toBe(latency);
  });

  it("presents a backend that settles without reporting submitted identically", async () => {
    const submission = scriptedBackend(latency, "settle-without-submitted").submit(signed);
    const early = collect(submission);
    await vi.runAllTimersAsync();
    const expected: SubmissionState[] = [
      { state: "submitted", operationId },
      { state: "settled", receipt },
    ];
    expect(await early).toEqual(expected);
    expect(await collect(submission)).toEqual(expected);
  });

  it("presents a rejection as a value, with its §10 error", async () => {
    const submission = scriptedBackend(latency, "reject").submit(signed);
    const early = collect(submission);
    await vi.runAllTimersAsync();
    const expected: SubmissionState[] = [
      { state: "submitted", operationId },
      { state: "rejected", error: rejection },
    ];
    expect(await submission).toEqual({ ok: false, error: rejection });
    expect(await early).toEqual(expected);
    expect(await collect(submission)).toEqual(expected);
  });
});

describe("createSubmission", () => {
  it("ends at the first terminal state and refuses later reports", () => {
    const controller = createSubmission();
    controller.rejected(rejection);
    expect(() => controller.settled(receipt)).toThrow(/already ended/);
    expect(() => controller.submitted(operationId)).toThrow(/already ended/);
  });

  it("refuses a second submitted", () => {
    const controller = createSubmission();
    controller.submitted(operationId);
    expect(() => controller.submitted(operationId)).toThrow(/already reported submitted/);
  });

  it("rejects awaiting and throws from iteration when something outside §10 fails", async () => {
    const controller = createSubmission();
    const early = collect(controller.submission);
    const reason = new Error("signer refused");
    controller.failed(reason);
    await expect(Promise.resolve(controller.submission)).rejects.toBe(reason);
    await expect(early).rejects.toBe(reason);
    await expect(collect(controller.submission)).rejects.toBe(reason);
  });

  it("lets an iterator stop early", async () => {
    const controller = createSubmission();
    controller.submitted(operationId);
    for await (const state of controller.submission) {
      expect(state.state).toBe("submitted");
      break;
    }
    controller.settled(receipt);
    expect(await controller.submission).toEqual({ ok: true, value: receipt });
  });
});

describe("the backend port (plan §5.8)", () => {
  it("submits signed commands or signed passes, with an optional sponsorship", () => {
    expectTypeOf<Backend["submit"]>()
      .parameter(0)
      .toEqualTypeOf<SignedCommand | SignedAccessPass>();
    expectTypeOf<Backend["submit"]>().parameter(1).toEqualTypeOf<Sponsorship | undefined>();
    expectTypeOf<ReturnType<Backend["submit"]>>().toEqualTypeOf<Submission<Receipt>>();
  });

  it("types each query's result", () => {
    type Answer = Awaited<ReturnType<Backend["query"]>>;
    expectTypeOf<Answer>().toExtend<Result<unknown>>();
    const backend = scriptedBackend(1, "settle");
    expectTypeOf(
      backend.query({ kind: "getCancellationHolder", ticket: "00" as never }),
    ).toEqualTypeOf<Promise<Result<AccountId | null>>>();
  });

  it("is awaitable and async-iterable at once", () => {
    expectTypeOf<Submission<Receipt>>().toExtend<PromiseLike<Result<Receipt>>>();
    expectTypeOf<Submission<Receipt>>().toExtend<AsyncIterable<SubmissionState>>();
  });
});
