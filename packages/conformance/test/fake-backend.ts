// A fake backend in test mode, for testing the harness itself. It enforces
// nothing and records every submission: the suite's behaviour tests are not
// expected to pass against it.

import {
  type AssuranceDeclaration,
  type Cursor,
  createSubmission,
  INVARIANT_IDS,
  type OperationId,
  type Sponsorship,
  type SubmitInput,
} from "@ticketto/sdk";
import type { TestBackend } from "../src/harness.js";

export interface FakeBackend extends TestBackend {
  readonly submitted: readonly { input: SubmitInput; sponsorship: Sponsorship | undefined }[];
}

/** A deterministic byte source: xorshift32 from a fixed seed. */
function seeded(seed: number): (length: number) => Uint8Array {
  let state = seed >>> 0 || 1;
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out[i] = state & 0xff;
    }
    return out;
  };
}

export async function fakeBackend(): Promise<FakeBackend> {
  const submitted: { input: SubmitInput; sponsorship: Sponsorship | undefined }[] = [];
  let time = Date.UTC(2026, 8, 14);
  const assurance = Object.fromEntries(
    INVARIANT_IDS.map((id) => [id, "attested"]),
  ) as unknown as AssuranceDeclaration;
  return {
    submitted,
    clock: {
      now: () => time,
      set: (next) => {
        time = next;
      },
      advance: (ms) => {
        time += ms;
      },
    },
    maxRecordingLag: 300_000,
    maxClockSkew: 10_000,
    maxPassWindow: 300_000,
    randomBytes: seeded(0x7c4e770),
    submit(input, sponsorship) {
      submitted.push({ input, sponsorship });
      const controller = createSubmission();
      const operationId = (
        input.kind === "command" ? input.signed.command.operationId : input.signed.pass.id
      ) as OperationId;
      controller.submitted(operationId);
      void Promise.resolve().then(() =>
        controller.settled({ operationId, cursor: String(submitted.length) as Cursor }),
      );
      return controller.submission;
    },
    query: async () => ({ ok: false, error: { code: "ERR-EventNotFound" } }),
    log: {
      read: async (from) => ({ ok: true, value: { records: [], next: from } }),
      hints: async function* () {},
    },
    assurance,
  };
}
