/// <reference types="node" />

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AccountId,
  type AssuranceDeclaration,
  type Authorisation,
  type Backend,
  type ClassId,
  type Command,
  type CreateEvent,
  type Cursor,
  createSubmission,
  createTicketto,
  type EventId,
  INVARIANT_IDS,
  type OperationId,
  type PassId,
  type PassPresentation,
  type Profile,
  type Receipt,
  type Result,
  type SignedAccessPass,
  type SignedCommand,
  type Signer,
  type Sponsor,
  type Sponsorship,
  type SubmitInput,
  type TicketId,
  type Ticketto,
  type TickettoError,
  type Timestamp,
  type ZoneId,
} from "./index.js";

// createTicketto against a fake backend and a fake profile. The real profile
// is F-003's; these fakes are deterministic stand-ins with no cryptography.

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const bytesReplacer = (_: string, value: unknown) =>
  value instanceof Uint8Array ? hex(value) : value;

const fakeProfile: Profile = {
  eventId: (creator, salt) => `event:${creator}:${hex(salt)}` as EventId,
  ticketId: (event, zone, placement) =>
    `ticket:${event}:${zone}:${JSON.stringify(placement)}` as TicketId,
  encodeCommand: (command) => encoder.encode(JSON.stringify(command, bytesReplacer)),
  accountOf: () => ({ ok: false, error: { code: "ERR-InvalidAuthorisation" } }),
  registrationAccount: () => ({ ok: false, error: { code: "ERR-InvalidAuthorisation" } }),
  verify: () => false,
  encodePass: (pass) => encoder.encode(JSON.stringify(pass)),
  decodePass: () => ({ ok: false, error: { code: "ERR-InvalidPass" } }),
};

function signerFor(account: string): Signer & { payloads: Uint8Array[] } {
  const payloads: Uint8Array[] = [];
  return {
    account: account as AccountId,
    payloads,
    async sign(payload) {
      payloads.push(payload);
      return encoder.encode(`signed-by:${account}:${payload.length}`) as Authorisation;
    },
  };
}

interface Submitted {
  readonly input: SubmitInput;
  readonly sponsorship: Sponsorship | undefined;
}

/** Records submissions; refuses a second event with an existing id, as the authority would. */
function fakeBackend() {
  const submitted: Submitted[] = [];
  const events = new Set<EventId>();
  let position = 0;
  const backend: Backend = {
    submit(input, sponsorship) {
      submitted.push({ input, sponsorship });
      const { submission, submitted: accepted, settled, rejected } = createSubmission();
      const operationId =
        input.kind === "command"
          ? input.signed.command.operationId
          : (input.signed.pass.id as string as OperationId);
      queueMicrotask(() => {
        accepted(operationId);
        if (input.kind === "command" && input.signed.command.kind === "createEvent") {
          const { event } = input.signed.command;
          if (events.has(event)) {
            rejected({ code: "ERR-EventIdExists" });
            return;
          }
          events.add(event);
        }
        position += 1;
        settled({ operationId, cursor: `c${position}` as Cursor });
      });
      return submission;
    },
    async query(query) {
      return { ok: false, error: { code: "ERR-EventNotFound", detail: query.kind } };
    },
    log: {
      async read(from) {
        return { ok: true, value: { records: [], next: from } };
      },
      async *hints() {},
    },
    assurance: Object.fromEntries(
      INVARIANT_IDS.map((id) => [id, "attested"]),
    ) as AssuranceDeclaration,
  };
  return { backend, submitted };
}

function fakeSponsor(
  refusal?: TickettoError,
): Sponsor & { sponsored: (SignedCommand | SignedAccessPass)[] } {
  const sponsored: (SignedCommand | SignedAccessPass)[] = [];
  return {
    sponsored,
    async sponsor(input): Promise<Result<Sponsorship>> {
      sponsored.push(input);
      if (refusal !== undefined) return { ok: false, error: refusal };
      return { ok: true, value: encoder.encode("sponsored") as Sponsorship };
    },
  };
}

function commandAt(submitted: readonly Submitted[], index: number): Command {
  const entry = submitted[index];
  if (entry === undefined || entry.input.kind !== "command") {
    throw new Error(`no command at ${index}`);
  }
  return entry.input.signed.command;
}

function setup(options: { refusal?: TickettoError } = {}) {
  const { backend, submitted } = fakeBackend();
  const sponsor = fakeSponsor(options.refusal);
  let counter = 0;
  const ticketto = createTicketto({
    backend,
    profile: fakeProfile,
    sponsor,
    operationLifetime: 120_000,
    now: () => 1_000,
    randomBytes: (length) => {
      counter += 1;
      return new Uint8Array(length).fill(counter);
    },
  });
  return { ticketto, submitted, sponsor };
}

function accessPass(): SignedAccessPass {
  return {
    pass: {
      ticket: "t" as TicketId,
      holder: "holder" as AccountId,
      id: "p1" as PassId,
      notBefore: 0,
      notAfter: 60_000,
    },
    authorisation: encoder.encode("holder-signature") as Authorisation,
  };
}

const organiser = signerFor("organiser");
const zone = { id: "z1" as ZoneId, kind: "Unseated" as const };
const transferInput = {
  event: "e" as EventId,
  ticket: "t" as TicketId,
  receiver: "friend" as AccountId,
};
const eventInput = {
  salt: encoder.encode("spring-gala"),
  zones: [zone],
  capacity: 100,
  metadata: null,
};

describe("createTicketto (REQ-EV-9, REQ-CM-1, REQ-SP-1)", () => {
  it("REQ-EV-9: a replayed createEvent produces the same EventId, and collides", async () => {
    const { ticketto, submitted } = setup();
    const first = ticketto.createEvent(organiser, eventInput);
    const replay = ticketto.createEvent(organiser, eventInput);

    expect(replay.id).toBe(first.id);
    expect(first.id).toBe(fakeProfile.eventId(organiser.account, eventInput.salt));
    expect(await first.submission).toMatchObject({ ok: true });
    expect(await replay.submission).toEqual({ ok: false, error: { code: "ERR-EventIdExists" } });

    const commands = submitted.map((_, index) => commandAt(submitted, index) as CreateEvent);
    expect(commands.map((c) => c.event)).toEqual([first.id, first.id]);
  });

  it("REQ-EV-9: a different salt or creator derives a different EventId", () => {
    const { ticketto } = setup();
    const a = ticketto.createEvent(organiser, eventInput).id;
    const b = ticketto.createEvent(organiser, { ...eventInput, salt: encoder.encode("other") }).id;
    const c = ticketto.createEvent(signerFor("someone-else"), eventInput).id;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("REQ-CM-1: wraps every command in a fresh operation id and an expiry", async () => {
    const { ticketto, submitted } = setup();
    const event = ticketto.createEvent(organiser, eventInput).id;
    await ticketto.setEventStatus(organiser, { event, status: "Sealed" });
    await ticketto.setEventCapacity(organiser, { event, capacity: 80, proof: null });

    const envelopes = submitted.map((_, index) => commandAt(submitted, index));
    expect(envelopes.map((c) => c.expiresAt)).toEqual([121_000, 121_000, 121_000]);
    expect(envelopes.map((c) => c.operationId)).toEqual([
      "01".repeat(16),
      "02".repeat(16),
      "03".repeat(16),
    ]);
  });

  it("does not let caller input override the kind, envelope or derived id", async () => {
    const { ticketto, submitted } = setup();
    const sneaky = { ...eventInput, kind: "removeZone", operationId: "x", event: "forged" };
    const { id, submission } = ticketto.createEvent(organiser, sneaky as typeof eventInput);
    await submission;
    const command = commandAt(submitted, 0) as CreateEvent;
    expect(command.kind).toBe("createEvent");
    expect(command.event).toBe(id);
    expect(command.operationId).toBe("01".repeat(16));
  });

  it("signs the profile's encoding of the command, and sponsors the signed command", async () => {
    const { ticketto, submitted, sponsor } = setup();
    const signer = signerFor("holder");
    const result = await ticketto.transferTicket(signer, {
      event: "e" as EventId,
      ticket: "t" as TicketId,
      receiver: "friend" as AccountId,
    });
    expect(result.ok).toBe(true);

    const [sent] = submitted;
    expect(sent?.input.kind).toBe("command");
    const signed = sent?.input.signed as SignedCommand;
    expect(signer.payloads).toEqual([fakeProfile.encodeCommand(signed.command)]);
    expect(hex(signed.authorisation)).toBe(
      hex(encoder.encode(`signed-by:holder:${signer.payloads[0]?.length}`)),
    );
    expect(sponsor.sponsored).toEqual([signed]);
    expect(sent?.sponsorship).toEqual(encoder.encode("sponsored"));
  });

  it("derives a ticket's id through the profile and issues it with its holder", async () => {
    const { ticketto, submitted } = setup();
    const placement = { kind: "Unseated" as const, discriminator: "d1" as never };
    const { id, submission } = ticketto.issueTicket(organiser, {
      event: "e" as EventId,
      zone: zone.id,
      placement,
      class: "press" as ClassId,
      provenance: "Granted",
      policy: { kind: "Single" },
      restrictions: { cannotResale: true, cannotTransfer: false },
      holder: "guest" as AccountId,
      metadata: null,
    });
    expect(id).toBe(fakeProfile.ticketId("e" as EventId, zone.id, placement));
    await submission;
    const command = commandAt(submitted, 0);
    expect(command).toMatchObject({ ticket: id, holder: "guest" });
  });

  it("presents the backend's states through the returned submission", async () => {
    const { ticketto } = setup();
    const submission = ticketto.removeRestriction(organiser, {
      event: "e" as EventId,
      ticket: "t" as TicketId,
      restriction: "cannotResale",
    });
    const states = [];
    for await (const state of submission) states.push(state.state);
    expect(states).toEqual(["submitted", "settled"]);
    const result = await submission;
    expect(result.ok && (result.value as Receipt).cursor).toBe("c1");
  });

  it("REQ-SP-1: submits nothing the sponsor refuses, and reports its error", async () => {
    const { ticketto, submitted } = setup({ refusal: { code: "ERR-LedgerUnavailable" } });
    const result = await ticketto.registerCredential(signerFor("new-device"), {
      account: "holder" as AccountId,
      registration: encoder.encode("registration") as never,
    });
    expect(result).toEqual({ ok: false, error: { code: "ERR-LedgerUnavailable" } });
    expect(submitted).toEqual([]);
  });

  it("fails the submission when the signer throws", async () => {
    const { ticketto, submitted } = setup();
    const refusing: Signer = {
      account: "holder" as AccountId,
      sign: async () => {
        throw new Error("biometric prompt dismissed");
      },
    };
    const submission = ticketto.addZone(refusing, { event: "e" as EventId, zone });
    await expect(Promise.resolve(submission)).rejects.toThrow("biometric prompt dismissed");
    expect(submitted).toEqual([]);
  });

  it("REQ-SP-1: submits an access pass as it is, unsigned by anyone else, with the sponsor's sponsorship", async () => {
    const { ticketto, submitted, sponsor } = setup();
    const pass = accessPass();
    expect(await ticketto.submitAccessPass(pass, { presentedAt: 30_000 })).toEqual({
      ok: true,
      value: { operationId: "p1", cursor: "c1" },
    });
    expect(sponsor.sponsored).toEqual([pass]);
    expect(submitted).toEqual([
      {
        input: { kind: "pass", signed: pass, presentedAt: 30_000 },
        sponsorship: encoder.encode("sponsored"),
      },
    ]);
  });

  it("REQ-AP-3: delivers the pass's presentedAt to the backend as given, not the client's clock", async () => {
    const { ticketto, submitted } = setup();
    await ticketto.submitAccessPass(accessPass(), { presentedAt: 42_000 });
    const [sent] = submitted;
    expect(sent?.input.kind === "pass" && sent.input.presentedAt).toBe(42_000);
  });

  it("requires presentedAt for an access pass, and offers no way to give a command one", () => {
    expectTypeOf<Parameters<Ticketto["submitAccessPass"]>>().toEqualTypeOf<
      [pass: SignedAccessPass, presentation: PassPresentation]
    >();
    expectTypeOf<PassPresentation["presentedAt"]>().toEqualTypeOf<Timestamp>();
    // Type-level only: never called.
    const misuse = (ticketto: Ticketto) => [
      // @ts-expect-error — presentedAt is required.
      ticketto.submitAccessPass(accessPass(), {}),
      // @ts-expect-error — nor may the presentation be omitted.
      ticketto.submitAccessPass(accessPass()),
      // @ts-expect-error — a command's input has no presentedAt.
      ticketto.transferTicket(organiser, { ...transferInput, presentedAt: 1 }),
    ];
    expect(misuse).toBeTypeOf("function");
  });

  it("REQ-SP-1: submits no access pass the sponsor refuses, and reports its error", async () => {
    const { ticketto, submitted } = setup({ refusal: { code: "ERR-LedgerUnavailable" } });
    expect(await ticketto.submitAccessPass(accessPass(), { presentedAt: 30_000 })).toEqual({
      ok: false,
      error: { code: "ERR-LedgerUnavailable" },
    });
    expect(submitted).toEqual([]);
  });

  it("answers queries, the log and the assurance declaration through the backend", async () => {
    const { ticketto } = setup();
    expect(await ticketto.getEvent("e" as EventId)).toEqual({
      ok: false,
      error: { code: "ERR-EventNotFound", detail: "getEvent" },
    });
    expect(await ticketto.canAttend("e" as EventId, "t" as TicketId)).toMatchObject({ ok: false });
    expect(await ticketto.getTicket("t" as TicketId)).toMatchObject({ ok: false });
    expect(await ticketto.getCancellationHolder("t" as TicketId)).toMatchObject({ ok: false });
    expect(Object.keys(ticketto.assurance())).toHaveLength(INVARIANT_IDS.length);
    expect(await ticketto.log.read("" as Cursor, 10)).toEqual({
      ok: true,
      value: { records: [], next: "" },
    });
  });
});
