// T-005-02: the C8 port over ledger-rules — submit, query, asynchronous
// settlement (features/005-backend-memory/plan.md §5.2; REQ-SDK-1, NFR-9).

import type { Capabilities } from "@ticketto/ledger-rules";
import { createProfileV0 } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import {
  type Authorisation,
  type Backend,
  createTicketto,
  type EventId,
  type OperationId,
  type PassId,
  type Sponsorship,
  type SubmissionState,
  type TicketId,
  type Ticketto,
  type ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { backendOver } from "./backend.js";
import { createMemoryCapabilities } from "./capabilities.js";
import { createMemoryBackend } from "./index.js";

const profile = createProfileV0({ rpId: "backend-memory.ticketto.test" });
const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(7) });
const sponsor = {
  sponsor: async () => ({ ok: true as const, value: new Uint8Array() as Sponsorship }),
};
const OPERATION_LIFETIME = 60_000;

function clientOver(backend: Backend, now: () => number = () => 1_000): Ticketto {
  let counter = 0;
  return createTicketto({
    backend,
    profile,
    sponsor,
    operationLifetime: OPERATION_LIFETIME,
    now,
    randomBytes: (length) => {
      counter += 1;
      return new Uint8Array(length).fill(counter);
    },
  });
}

/** Every state a submission passes through, in order. */
async function statesOf(submission: AsyncIterable<SubmissionState>): Promise<SubmissionState[]> {
  const states: SubmissionState[] = [];
  for await (const state of submission) states.push(state);
  return states;
}

const zone = { id: "11".repeat(32) as ZoneId, kind: "Seated" as const };
const eventId = "22".repeat(32) as EventId;
const ticketId = "33".repeat(32) as TicketId;

describe("in-memory backend: the C8 port", () => {
  it("REQ-SDK-1: createTicketto creates an event end to end", async () => {
    const caps = createMemoryCapabilities({ clock: { now: () => 1_000 } });
    // The organiser's credential, registered as the ledger records one (REQ-CP-6).
    const claimed = profile.registrationAccount(organiser.registration);
    if (!claimed.ok) throw new Error(claimed.error.code);
    await caps.registry.addRegistration(organiser.signer.account, {
      credential: claimed.value.credential,
      registration: organiser.registration,
    });
    const ticketto = clientOver(backendOver(caps, profile));

    const { id, submission } = ticketto.createEvent(organiser.signer, {
      salt: new Uint8Array(32).fill(1),
      zones: [zone],
      capacity: 100,
      metadata: null,
    });
    const states = await statesOf(submission);
    expect(states.map((s) => s.state)).toEqual(["submitted", "settled"]);
    const receipt = await submission;
    if (!receipt.ok) throw new Error(receipt.error.code);

    expect(await ticketto.getEvent(id)).toEqual({
      ok: true,
      value: {
        id,
        owner: organiser.signer.account,
        status: "Active",
        maxCapacity: 100,
        issued: 0,
        zones: [zone],
      },
    });
    expect(receipt.value.operationId).toBe(
      states[0]?.state === "submitted" && states[0].operationId,
    );
  });

  it("reports submitted before submit returns, with the command's operation id", async () => {
    const backend = createMemoryBackend({ profile, clock: { now: () => 1_000 } });
    const operationId = "ab".repeat(16) as OperationId;
    const submission = backend.submit({
      kind: "command",
      signed: {
        command: {
          kind: "setEventStatus",
          operationId,
          expiresAt: 0,
          event: eventId,
          status: "Sealed",
        },
        authorisation: new Uint8Array() as Authorisation,
      },
    });
    const iterator = submission[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({
      done: false,
      value: { state: "submitted", operationId },
    });
    await iterator.return?.();
    await submission;
  });

  it("NFR-9: never settles synchronously — settlement waits for a later microtask", async () => {
    const backend = createMemoryBackend({ profile, clock: { now: () => 1_000 } });
    const submission = backend.submit({
      kind: "command",
      signed: {
        command: {
          kind: "setEventStatus",
          operationId: "cd".repeat(16) as OperationId,
          expiresAt: 0,
          event: eventId,
          status: "Sealed",
        },
        authorisation: new Uint8Array() as Authorisation,
      },
    });
    let settled = false;
    submission.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await submission;
    expect(settled).toBe(true);
  });

  it("reports a pass's id as its operation id", async () => {
    const backend = createMemoryBackend({ profile, clock: { now: () => 1_000 } });
    const passId = "ef".repeat(16) as PassId;
    const submission = backend.submit({
      kind: "pass",
      signed: {
        pass: {
          ticket: ticketId,
          holder: organiser.signer.account,
          id: passId,
          notBefore: 0,
          notAfter: 60_000,
        },
        authorisation: new Uint8Array() as Authorisation,
      },
      presentedAt: 1_000,
    });
    const iterator = submission[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ state: "submitted", operationId: passId });
    await iterator.return?.();
    // How the rules judge the pass is theirs to say; only its operation id is the port's.
    await Promise.resolve(submission).catch(() => {});
  });

  it("ERR-OperationExpired: a rejection by the rules settles as rejected, through the SDK", async () => {
    const backend = createMemoryBackend({ profile, clock: { now: () => 1_000_000 } });
    // The client's clock is behind the ledger's: the envelope has expired by the time it lands.
    const ticketto = clientOver(backend, () => 0);
    const { submission } = ticketto.createEvent(organiser.signer, {
      salt: new Uint8Array(32),
      zones: [zone],
      capacity: null,
      metadata: null,
    });
    const states = await statesOf(submission);
    expect(states.map((s) => s.state)).toEqual(["submitted", "rejected"]);
    const result = await submission;
    expect(result.ok ? null : result.error.code).toBe("ERR-OperationExpired");
  });

  it("ERR-InvalidAuthorisation: a command from an unregistered credential is rejected, through the SDK", async () => {
    const backend = createMemoryBackend({ profile, clock: { now: () => 1_000 } });
    const ticketto = clientOver(backend);
    const { submission } = ticketto.createEvent(organiser.signer, {
      salt: new Uint8Array(32),
      zones: [zone],
      capacity: null,
      metadata: null,
    });
    const result = await submission;
    expect(result.ok ? null : result.error.code).toBe("ERR-InvalidAuthorisation");
  });

  it("fails a submission, loudly, when the rules or the store throw", async () => {
    const caps = createMemoryCapabilities({ clock: { now: () => 1_000 } });
    const defect = new Error("the store broke");
    const broken: Capabilities = {
      ...caps,
      transaction: async () => {
        throw defect;
      },
    };
    const ticketto = clientOver(backendOver(broken, profile));
    const { submission } = ticketto.createEvent(organiser.signer, {
      salt: new Uint8Array(32),
      zones: [zone],
      capacity: null,
      metadata: null,
    });
    await expect(Promise.resolve(submission)).rejects.toBe(defect);
    await expect(statesOf(submission)).rejects.toBe(defect);
  });

  it("ERR-EventNotFound, ERR-TicketNotFound: answers point queries through the rules", async () => {
    const ticketto = clientOver(createMemoryBackend({ profile }));
    const event = await ticketto.getEvent(eventId);
    expect(event.ok ? null : event.error.code).toBe("ERR-EventNotFound");
    const ticket = await ticketto.getTicket(ticketId);
    expect(ticket.ok ? null : ticket.error.code).toBe("ERR-TicketNotFound");
  });

  it("uses the clock it is given as the ledger's clock", async () => {
    let now = 1_000;
    const backend = createMemoryBackend({ profile, clock: { now: () => now } });
    const ticketto = clientOver(backend, () => 0);
    const input = { salt: new Uint8Array(32), zones: [zone], capacity: null, metadata: null };
    // Envelopes expire at the client's 0 + OPERATION_LIFETIME, judged by the ledger's clock.
    now = OPERATION_LIFETIME;
    const atExpiry = await ticketto.createEvent(organiser.signer, input).submission;
    expect(atExpiry.ok ? null : atExpiry.error.code).not.toBe("ERR-OperationExpired");
    now = OPERATION_LIFETIME + 1;
    const afterExpiry = await ticketto.createEvent(organiser.signer, input).submission;
    expect(afterExpiry.ok ? null : afterExpiry.error.code).toBe("ERR-OperationExpired");
  });
});
