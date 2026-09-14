// T-003-06 — `createTicketto` (F-002) runs against the V0 profile with a fake
// backend (REQ-CP-2). The fake backend checks what arrives the way the rules
// will: each command's authorisation against the signer's registration,
// through the profile, and every pass's signature and window.

import {
  type Backend,
  type Cursor,
  createSubmission,
  createTicketto,
  type EventId,
  INVARIANT_IDS,
  type OperationId,
  type PassId,
  type Registration,
  type SignedAccessPass,
  type SignedCommand,
  type Sponsorship,
  type ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { Random } from "../test/random.js";
import { p256Credential, type TestCredential, webAuthnCredential } from "../test/signers.js";
import { decodePass, encodeSignedPass, producePass, verifyPass } from "./pass.js";
import { createProfileV0 } from "./profile.js";

const RP_ID = "kippu.example";
const NOW = 1_760_000_000_000;

function fakeBackend(registrations: readonly TestCredential[]) {
  const profile = createProfileV0({ rpId: RP_ID });
  const registered = new Map<string, Registration>();
  for (const { registration } of registrations) {
    const named = profile.registrationAccount(registration);
    if (!named.ok) throw new Error("a test registration does not register");
    registered.set(`${named.value.account}/${named.value.credential}`, registration);
  }
  const events = new Set<EventId>();
  const accepted: (SignedCommand | SignedAccessPass)[] = [];
  let position = 0;

  const backend: Backend = {
    submit(input) {
      const { submission, settled, rejected } = createSubmission();
      queueMicrotask(() => {
        const authorisation = input.authorisation;
        const claimed = profile.accountOf(authorisation);
        if (!claimed.ok) return rejected(claimed.error);
        const signer = claimed.value;
        const registration = registered.get(`${signer.account}/${signer.credential}`);
        if (registration === undefined) return rejected({ code: "ERR-InvalidAuthorisation" });
        if ("command" in input) {
          const payload = profile.encodeCommand(input.command);
          if (!profile.verify(registration, payload, authorisation)) {
            return rejected({ code: "ERR-InvalidAuthorisation" });
          }
          if (input.command.kind === "createEvent") {
            if (input.command.event !== profile.eventId(signer.account, input.command.salt)) {
              return rejected({ code: "ERR-InvalidAuthorisation" });
            }
            if (events.has(input.command.event)) return rejected({ code: "ERR-EventIdExists" });
            events.add(input.command.event);
          }
        } else {
          const decoded = profile.decodePass(encodeSignedPass(input));
          if (!decoded.ok) return rejected(decoded.error);
          const verdict = verifyPass(
            decoded.value,
            registration,
            { now: () => NOW },
            { rpId: RP_ID },
          );
          if (!verdict.ok) return rejected(verdict.error);
        }
        accepted.push(input);
        position += 1;
        const operationId =
          "command" in input ? input.command.operationId : (input.pass.id as string as OperationId);
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
    ) as Backend["assurance"],
  };
  return { backend, accepted, profile };
}

describe("T-003-06 createTicketto with the V0 profile", () => {
  const random = new Random(0x5d4);
  const organiser = p256Credential(random);
  const holder = webAuthnCredential(random, RP_ID);
  const stranger = webAuthnCredential(random, RP_ID);

  function setup() {
    const { backend, accepted, profile } = fakeBackend([organiser, holder]);
    let counter = 0;
    const ticketto = createTicketto({
      backend,
      profile,
      sponsor: { sponsor: async () => ({ ok: true, value: new Uint8Array(1) as Sponsorship }) },
      operationLifetime: 120_000,
      now: () => NOW,
      randomBytes: (length) => new Uint8Array(length).fill(++counter),
    });
    return { ticketto, accepted, profile };
  }

  it("REQ-EV-9: creates an event under the profile's EventId; a replay derives the same id and collides", async () => {
    const { ticketto, profile } = setup();
    const zone = { id: random.zoneId(), kind: "Unseated" as const };
    const input = { salt: random.bytes(16), zones: [zone], capacity: 100, metadata: null };
    const first = ticketto.createEvent(organiser.signer, input);
    expect(first.id).toBe(profile.eventId(organiser.signer.account, input.salt));
    expect((await first.submission).ok).toBe(true);
    const replay = ticketto.createEvent(organiser.signer, input);
    expect(replay.id).toBe(first.id);
    expect(await replay.submission).toEqual({ ok: false, error: { code: "ERR-EventIdExists" } });
  });

  it("issues a ticket under the profile's TicketId, signed by organiser authority", async () => {
    const { ticketto, profile, accepted } = setup();
    const event = random.eventId();
    const zone = random.zoneId() as ZoneId;
    const placement = random.placement();
    const issued = ticketto.issueTicket(organiser.signer, {
      event,
      zone,
      placement,
      class: random.classId(),
      provenance: "Purchased",
      policy: { kind: "Single" },
      restrictions: { cannotResale: false, cannotTransfer: false },
      holder: holder.signer.account,
      metadata: null,
    });
    expect(issued.id).toBe(profile.ticketId(event, zone, placement));
    expect((await issued.submission).ok).toBe(true);
    expect(accepted).toHaveLength(1);
  });

  it("a holder's passkey signs a transfer; an unregistered credential is refused", async () => {
    const { ticketto } = setup();
    const input = {
      event: random.eventId(),
      ticket: random.ticketId(),
      receiver: random.accountId(),
    };
    expect((await ticketto.transferTicket(holder.signer, input)).ok).toBe(true);
    expect(await ticketto.transferTicket(stranger.signer, input)).toEqual({
      ok: false,
      error: { code: "ERR-InvalidAuthorisation" },
    });
  });

  it("submits a holder's access pass; AC-E1.2 a pass signed by a non-holder is rejected", async () => {
    const { ticketto } = setup();
    const ticket = random.ticketId();
    const pass = await producePass(
      { ticket, holder: holder.signer.account, notBefore: NOW - 1_000 },
      holder.signer,
    );
    const decoded = decodePass(encodeSignedPass(pass));
    expect(decoded.ok).toBe(true);
    expect((await ticketto.submitAccessPass(pass)).ok).toBe(true);

    const forged = await producePass(
      {
        ticket,
        holder: organiser.signer.account,
        notBefore: NOW - 1_000,
        id: random.hex<PassId>(16),
      },
      organiser.signer,
    );
    const moved = { ...forged, pass: { ...forged.pass, holder: holder.signer.account } };
    expect(await ticketto.submitAccessPass(moved)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "ERR-InvalidPass" }),
    });
  });
});
