/// <reference types="node" />

import {
  type Cursor,
  createSubmission,
  type OperationId,
  type Receipt,
  type Result,
  type Submission,
  type SubmissionState,
  type TickettoError,
} from "@ticketto/sdk";
import { firstValueFrom, lastValueFrom, type Observable, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { fromHints, fromSubmission, packageName } from "./index.js";

// T-002-11 — Done when: Observable and awaited forms observe identical state
// sequences. Each scripted write runs at 1 ms and at 60 s (NFR-9), on fake
// timers, and is observed three ways at once: awaited, iterated, and through
// the Observable.

const operationId = "0f".repeat(16) as OperationId;
const receipt: Receipt = { operationId, cursor: "c-1" as Cursor };
const rejection: TickettoError = { code: "ERR-EventSealed" };
const defect = new Error("signer threw");

type Script = "settle" | "settle-without-submitted" | "reject" | "fail";

/** A write that is accepted at once and completes `latency` ms later, per `script`. */
function scripted(latency: number, script: Script): Submission<Receipt> {
  const controller = createSubmission();
  if (script !== "settle-without-submitted") {
    setTimeout(() => controller.submitted(operationId), 0);
  }
  setTimeout(() => {
    if (script === "reject") controller.rejected(rejection);
    else if (script === "fail") controller.failed(defect);
    else controller.settled(receipt);
  }, latency);
  return controller.submission;
}

type Observed =
  | { readonly states: readonly SubmissionState[]; readonly end: "complete" }
  | {
      readonly states: readonly SubmissionState[];
      readonly end: "error";
      readonly reason: unknown;
    };

function observe(observable: Observable<SubmissionState>): Promise<Observed> {
  const states: SubmissionState[] = [];
  return new Promise((resolve) => {
    observable.subscribe({
      next: (state) => states.push(state),
      complete: () => resolve({ states, end: "complete" }),
      error: (reason: unknown) => resolve({ states, end: "error", reason }),
    });
  });
}

async function iterate(submission: Submission<Receipt>): Promise<Observed> {
  const states: SubmissionState[] = [];
  try {
    for await (const state of submission) states.push(state);
    return { states, end: "complete" };
  } catch (reason) {
    return { states, end: "error", reason };
  }
}

async function awaited(
  submission: Submission<Receipt>,
): Promise<{ result: Result<Receipt> } | { reason: unknown }> {
  try {
    return { result: await submission };
  } catch (reason) {
    return { reason };
  }
}

/** The terminal state an awaited result stands for. */
function terminal(result: Result<Receipt>): SubmissionState {
  return result.ok
    ? { state: "settled", receipt: result.value }
    : { state: "rejected", error: result.error };
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
])("NFR-9: a backend at %s, through @ticketto/rx", (_, latency) => {
  describe.each([
    ["settles", "settle"],
    ["settles without reporting submitted", "settle-without-submitted"],
    ["rejects with a §10 error", "reject"],
  ] as const)("a write that %s", (_, script) => {
    it("is observed as the same state sequence as the awaited and iterated forms", async () => {
      const submission = scripted(latency, script);
      const early = observe(fromSubmission(submission));
      const iterated = iterate(submission);
      const result = awaited(submission);

      await vi.advanceTimersByTimeAsync(latency - 1);
      await vi.runAllTimersAsync();

      const observed = await early;
      const awaitedOutcome = await result;
      expect(observed).toEqual(await iterated);
      expect(observed.end).toBe("complete");
      expect(observed.states[0]).toEqual({ state: "submitted", operationId });
      expect("result" in awaitedOutcome).toBe(true);
      if ("result" in awaitedOutcome) {
        expect(observed.states.at(-1)).toEqual(terminal(awaitedOutcome.result));
      }
      // A subscriber arriving after completion still sees every state.
      expect(await observe(fromSubmission(submission))).toEqual(observed);
      expect(Date.now()).toBe(latency);
    });
  });

  it("errors, as awaiting rejects, when the write fails outside §10", async () => {
    const submission = scripted(latency, "fail");
    const early = observe(fromSubmission(submission));
    const iterated = iterate(submission);
    const result = awaited(submission);

    await vi.runAllTimersAsync();

    const observed = await early;
    expect(observed).toEqual(await iterated);
    expect(observed).toEqual({
      states: [{ state: "submitted", operationId }],
      end: "error",
      reason: defect,
    });
    expect(await result).toEqual({ reason: defect });
  });

  it("emits nothing before the backend has reported, however long it takes", async () => {
    const submission = scripted(latency, "settle");
    const seen: SubmissionState[] = [];
    const subscription = fromSubmission(submission).subscribe((state) => seen.push(state));

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ state: "submitted", operationId }]);
    if (latency > 1) {
      await vi.advanceTimersByTimeAsync(latency - 1);
      expect(seen).toEqual([{ state: "submitted", operationId }]);
    }
    await vi.runAllTimersAsync();
    expect(seen).toEqual([
      { state: "submitted", operationId },
      { state: "settled", receipt },
    ]);
    subscription.unsubscribe();
  });
});

describe("fromSubmission", () => {
  it("serves operators such as lastValueFrom with the terminal state", async () => {
    vi.useRealTimers();
    const controller = createSubmission();
    const last = lastValueFrom(fromSubmission(controller.submission));
    const all = firstValueFrom(fromSubmission(controller.submission).pipe(toArray()));
    controller.settled(receipt);
    expect(await last).toEqual({ state: "settled", receipt });
    expect(await all).toEqual([
      { state: "submitted", operationId },
      { state: "settled", receipt },
    ]);
  });

  it("stops emitting to a subscriber that unsubscribed", async () => {
    vi.useRealTimers();
    const controller = createSubmission();
    const seen: SubmissionState[] = [];
    const subscription = fromSubmission(controller.submission).subscribe({
      next: (state) => seen.push(state),
      complete: () => seen.push({ state: "rejected", error: { code: "ERR-LedgerUnavailable" } }),
    });
    controller.submitted(operationId);
    await new Promise((r) => setTimeout(r, 0));
    subscription.unsubscribe();
    controller.settled(receipt);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([{ state: "submitted", operationId }]);
    // The submission itself is untouched: other forms still observe it whole.
    expect(await controller.submission).toEqual({ ok: true, value: receipt });
  });

  it("is typed as an Observable of SubmissionState", () => {
    expectTypeOf(fromSubmission<Receipt>).returns.toEqualTypeOf<Observable<SubmissionState>>();
  });
});

describe("fromHints (AD-17)", () => {
  it("emits the cursors hinted, and nothing else", async () => {
    vi.useRealTimers();
    const log = {
      async *hints(): AsyncIterable<Cursor> {
        yield "c-1" as Cursor;
        yield "c-2" as Cursor;
      },
    };
    expect(await firstValueFrom(fromHints(log).pipe(toArray()))).toEqual(["c-1", "c-2"]);
    expectTypeOf(fromHints).returns.toEqualTypeOf<Observable<Cursor>>();
  });

  it("opens a stream per subscription and closes it on unsubscribe", async () => {
    vi.useRealTimers();
    let opened = 0;
    let closed = 0;
    let push: (() => void) | undefined;
    const log = {
      async *hints(): AsyncIterable<Cursor> {
        opened += 1;
        try {
          for (let i = 1; ; i += 1) {
            await new Promise<void>((r) => {
              push = r;
            });
            yield `c-${i}` as Cursor;
          }
        } finally {
          closed += 1;
        }
      },
    };
    const seen: Cursor[] = [];
    const subscription = fromHints(log).subscribe((cursor) => seen.push(cursor));
    const tick = () => new Promise((r) => setTimeout(r, 0));
    await tick();
    push?.();
    await tick();
    expect(seen).toEqual(["c-1"]);
    subscription.unsubscribe();
    push?.();
    await tick();
    expect(seen).toEqual(["c-1"]);
    expect(opened).toBe(1);
    expect(closed).toBe(1);
  });

  it("errors with whatever the hint stream throws", async () => {
    vi.useRealTimers();
    const failure = new Error("hint stream broke");
    const log = {
      // biome-ignore lint/correctness/useYield: a stream that fails before hinting anything.
      async *hints(): AsyncIterable<Cursor> {
        throw failure;
      },
    };
    await expect(firstValueFrom(fromHints(log))).rejects.toBe(failure);
  });
});

describe("@ticketto/rx", () => {
  it("exports its package name", () => {
    expect(packageName).toBe("@ticketto/rx");
  });
});
