// T-007-02 — `submit` with long-poll settlement and idempotent retry
// (REQ-CM-1, NFR-9). Done when: a dropped connection mid-submission yields
// exactly one state change.
//
// The inputs are the C4 vectors' own signed inputs, decoded with the profile
// and handed to the port as SDK values: the port must frame them back into the
// very bytes the vectors carry. Portable: Node and Hermes.

import { decodeSignedAccessPass, decodeSignedCommand } from "@ticketto/profile-v0";
import type {
  Receipt,
  Result,
  SignedAccessPass,
  SignedCommand,
  Sponsorship,
  Submission,
  SubmissionState,
  SubmitInput,
} from "@ticketto/sdk";
import { createC4Client } from "../../src/client.js";
import { fromHex } from "../../src/hex.js";
import type { RetryPolicy } from "../../src/retry.js";
import { C4Defect, createOffchainSubmit } from "../../src/submit.js";
import { BASE_URL } from "../fake-fetch.js";
import {
  FakeService,
  type FakeServiceOptions,
  type Fault,
  InstantTimers,
  TIMEOUT_MARGIN,
} from "../fake-service.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import type { C4Vectors } from "./vectors.suite.js";

type Body = {
  input: { kind: string; bytes: string };
  sponsorship: string | null;
  presentedAt?: number;
};

const WAIT = 25_000;

export interface Fixtures {
  readonly createEvent: SubmitInput;
  readonly transfer: SubmitInput;
  readonly conflicting: SubmitInput;
  readonly pass: SubmitInput;
  /** The sponsorship the vectors record for each input. */
  readonly sponsorships: ReadonlyMap<SubmitInput, Sponsorship>;
  /** The request body the vectors record for each input. */
  readonly bodies: ReadonlyMap<SubmitInput, string>;
}

export function fixtures(vectors: C4Vectors): Fixtures {
  const body = (name: string): Body => {
    const exchange = vectors.exchanges.find((e) => e.name === name);
    assert(exchange !== undefined, `no vector named ${name}`);
    return exchange.request.body as unknown as Body;
  };
  const sponsorships = new Map<SubmitInput, Sponsorship>();
  const bodies = new Map<SubmitInput, string>();
  const record = (input: SubmitInput, b: Body) => {
    sponsorships.set(input, fromHex(b.sponsorship as string) as Sponsorship);
    bodies.set(input, JSON.stringify(b));
    return input;
  };
  const command = (name: string): SubmitInput => {
    const b = body(name);
    const decoded = decodeSignedCommand(fromHex(b.input.bytes));
    assert(decoded.ok, `${name} does not decode`);
    return record({ kind: "command", signed: decoded.value as SignedCommand }, b);
  };
  const createEvent = command("submit a sponsored command: createEvent by the organiser");
  const transfer = command(
    "submit a sponsored command on the direct path: transferTicket by the holder",
  );
  const conflicting = command(
    "submit a different command under a recorded operation id: a different token",
  );
  const p = body("submit a sponsored access pass with presentedAt");
  const decoded = decodeSignedAccessPass(fromHex(p.input.bytes));
  assert(decoded.ok, "the pass does not decode");
  const pass = record(
    {
      kind: "pass",
      signed: decoded.value as SignedAccessPass,
      presentedAt: p.presentedAt as number,
    },
    p,
  );
  return { createEvent, transfer, conflicting, pass, sponsorships, bodies };
}

export interface Run {
  readonly service: FakeService;
  readonly timers: InstantTimers;
  readonly submit: (input: SubmitInput, sponsorship?: Sponsorship) => Submission<Receipt>;
}

export function setUp(
  options: FakeServiceOptions & { readonly retry?: Partial<RetryPolicy> } = {},
): Run {
  const timers = new InstantTimers();
  const service = new FakeService({ ...options, onHang: () => timers.expire() });
  const client = createC4Client({ url: BASE_URL, fetch: service.fetch });
  const submit = createOffchainSubmit({
    client,
    timers,
    wait: WAIT,
    timeoutMargin: TIMEOUT_MARGIN,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  });
  return { service, timers, submit };
}

/** Every state a submission goes through, and how it ends. */
export async function complete(
  submission: Submission<Receipt>,
): Promise<{ states: SubmissionState[]; result: Result<Receipt> | undefined; failure?: unknown }> {
  const states: SubmissionState[] = [];
  const iterator = submission[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      states.push(next.value);
    }
  } catch (failure) {
    return { states, result: undefined, failure };
  }
  return { states, result: await submission };
}

function kinds(states: readonly SubmissionState[]): string[] {
  return states.map((s) => s.state);
}

export function submitSuite(vectors: C4Vectors): Suite {
  const f = fixtures(vectors);
  const sponsorshipOf = (input: SubmitInput): Sponsorship => {
    const sponsorship = f.sponsorships.get(input);
    assert(sponsorship !== undefined, "no sponsorship for this input");
    return sponsorship;
  };

  /** Submits `input` against a service with `faults`, and checks it settles as one state change. */
  async function settlesOnce(
    input: SubmitInput,
    options: FakeServiceOptions,
  ): Promise<Run & { states: SubmissionState[] }> {
    const run = setUp(options);
    const { states, result } = await complete(run.submit(input, sponsorshipOf(input)));
    assertEqual(kinds(states), ["submitted", "settled"], "states");
    assert(result?.ok === true, "the submission settles");
    assertEqual(run.service.recorded.length, 1, "state changes recorded by the ledger");
    for (const sent of run.service.submits) {
      assertEqual(sent, f.bodies.get(input), "every submit request is the identical request");
    }
    return { ...run, states };
  }

  return (t) => {
    t.describe("T-007-02 submit over C4", () => {
      t.it("frames each SDK input into exactly the bytes the C4 vectors carry", async () => {
        for (const input of [f.createEvent, f.transfer, f.pass]) {
          const run = setUp();
          await complete(run.submit(input, sponsorshipOf(input)));
          assertEqual(run.service.submits, [f.bodies.get(input)], "the submit request");
        }
      });

      t.it(
        "REQ-CM-1: a connection dropped after the service accepted the submission yields exactly one state change",
        async () => {
          const run = await settlesOnce(f.transfer, { faults: ["drop-after"] });
          assertEqual(run.service.submits.length, 2, "the request was resent");
        },
      );

      t.it(
        "REQ-CM-1: a connection dropped before the request reached the service yields exactly one state change",
        async () => {
          const run = await settlesOnce(f.transfer, { faults: ["drop-before", "drop-before"] });
          assertEqual(run.service.submits.length, 1, "one request reached the service");
        },
      );

      t.it("REQ-CM-1: a long-poll dropped mid-way is repeated, not resubmitted", async () => {
        const run = await settlesOnce(f.createEvent, {
          pendingPolls: 2,
          faults: ["none", "drop-after", "drop-before", "none"],
        });
        assertEqual(run.service.submits.length, 1, "submitted once");
      });

      t.it(
        "REQ-CM-1: a service that lost a pending submission is sent the identical request again",
        async () => {
          const run = await settlesOnce(f.transfer, { faults: ["none", "restart"] });
          assertEqual(run.service.submits.length, 2, "resubmitted after operation-unknown");
        },
      );

      t.it(
        "REQ-CM-1: hung requests are abandoned and retried without a second state change",
        async () => {
          const run = await settlesOnce(f.createEvent, { faults: ["hang", "none", "hang"] });
          assertEqual(run.service.submits.length, 2, "the hung submit was resent");
          const timeouts = run.timers.delays.filter((d) => d >= TIMEOUT_MARGIN);
          assert(timeouts.includes(TIMEOUT_MARGIN), "a submit request times out after the margin");
          assert(
            timeouts.includes(WAIT + TIMEOUT_MARGIN),
            "a poll times out after wait plus the margin",
          );
        },
      );

      t.it(
        "NFR-9: a write pending across many long-polls settles, reported submitted once",
        async () => {
          const run = await settlesOnce(f.pass, { pendingPolls: 12 });
          const polls = run.service.seen.filter((s) => s.method === "GET");
          assertEqual(polls.length, 13, "long-polls");
          for (const poll of polls) assert(poll.path.endsWith(`&wait=${WAIT}`), poll.path);
          assertEqual(run.timers.backoffs, [], "pending is progress, never backed off");
        },
      );

      t.it(
        "an access pass is submitted with its presentedAt, and settles under its pass id",
        async () => {
          const run = setUp();
          const result = await run.submit(f.pass, sponsorshipOf(f.pass));
          const sent = JSON.parse(run.service.submits[0] ?? "{}") as Body;
          assert(f.pass.kind === "pass");
          assertEqual(sent.presentedAt, f.pass.presentedAt, "presentedAt");
          assert(result.ok, "settled");
          assertEqual(result.value.operationId, f.pass.signed.pass.id, "operation id");
        },
      );

      t.it(
        "unavailability and proxy errors are retried with backoff, honouring Retry-After",
        async () => {
          const run = await settlesOnce(f.transfer, {
            faults: [{ unavailable: 2 }, "bad-gateway", "none", { unavailable: null }],
          });
          // 202 is not progress on its own; a pending or settled poll is.
          assertEqual(run.timers.backoffs, [2000, 500, 1000], "backoffs");
        },
      );

      t.it(
        "ERR-OperationConflict: a different command under a recorded operation id is rejected, and recorded nothing",
        async () => {
          const run = setUp();
          const first = await run.submit(f.transfer, sponsorshipOf(f.transfer));
          assert(first.ok, "the first settles");
          const { states } = await complete(
            run.submit(f.conflicting, sponsorshipOf(f.conflicting)),
          );
          assertEqual(kinds(states), ["submitted", "rejected"], "states");
          const last = states[1];
          assert(last?.state === "rejected");
          assertEqual(last.error, { code: "ERR-OperationConflict" });
          assertEqual(run.service.recorded.length, 1, "state changes");
        },
      );

      t.it("ERR-PassReplayed: a rejection by the rules is reported after submitted", async () => {
        const run = setUp({
          rules: () => ({ code: "ERR-PassReplayed", detail: "pass already consumed" }),
        });
        const { states } = await complete(run.submit(f.pass, sponsorshipOf(f.pass)));
        assertEqual(states.slice(1), [
          {
            state: "rejected",
            error: { code: "ERR-PassReplayed", detail: "pass already consumed" },
          },
        ]);
        assertEqual(run.service.recorded.length, 0, "state changes");
      });

      t.it(
        "ERR-SponsorshipRefused: a submission without a sponsorship is rejected at once, never retried",
        async () => {
          const run = setUp();
          const { states } = await complete(run.submit(f.transfer));
          assertEqual(states, [{ state: "rejected", error: { code: "ERR-SponsorshipRefused" } }]);
          assertEqual(run.service.seen.length, 1, "requests");
        },
      );

      t.it("a defect fails the submission and is never retried", async () => {
        const run = setUp({ faults: ["none", "malformed"] });
        const { states, failure } = await complete(
          run.submit(f.createEvent, sponsorshipOf(f.createEvent)),
        );
        assertEqual(kinds(states), ["submitted"], "states before the failure");
        assert(failure instanceof C4Defect, "fails with a C4Defect");
        assertEqual(run.service.seen.length, 2, "requests");
        let rejected = false;
        await run.submit(f.createEvent, sponsorshipOf(f.createEvent)).then(
          () => {},
          () => {
            rejected = true;
          },
        );
        // A second submission against a service that now answers normally settles.
        assertEqual(rejected, false, "an identical later submission is unaffected");
      });

      t.it("ERR-LedgerUnavailable: a spent retry budget rejects with the ruled code", async () => {
        const faults: Fault[] = ["drop-before", "drop-before", "drop-before"];
        const run = setUp({ faults, retry: { attempts: 2 } });
        const { states } = await complete(run.submit(f.transfer, sponsorshipOf(f.transfer)));
        assertEqual(states, [{ state: "rejected", error: { code: "ERR-LedgerUnavailable" } }]);
        assertEqual(run.service.seen.length, 3, "requests");
        assertEqual(run.timers.backoffs, [250, 500], "backoffs");
      });
    });
  };
}
