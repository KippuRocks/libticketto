// T-005-09: probes that need the gate rules (AC-B1.4, REQ-SDK-7, REQ-MG-3;
// features/005-backend-memory/tasks.md). AC-B1.4 by advancing the /testing
// clock; and, after an export and import round trip, the state no query shows:
// consumed passes, probed by resubmission, and cancellation holders, read back
// through getCancellationHolder.

import { importVerified } from "@ticketto/log";
import { createProfileV0, producePass } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import {
  type AttendancePolicy,
  type ClassId,
  createTicketto,
  type Discriminator,
  type EventId,
  type PassId,
  type Receipt,
  type Result,
  type SignedAccessPass,
  type Sponsorship,
  type TicketId,
  type Ticketto,
  type Timestamp,
  type ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { backendOver, type MemoryBackend } from "./backend.js";
import { createMemoryStore, type MemoryStore } from "./capabilities.js";
import {
  type ControlledClock,
  createControlledClock,
  createTestMemoryBackend,
  TEST_EPOCH,
} from "./testing/index.js";

const profile = createProfileV0({ rpId: "backend-memory.ticketto.test" });
const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x51) });
const holder = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x52) });
const publication = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x53) });
const zone = "8e".repeat(32) as ZoneId;
const MINUTE = 60_000;

/** The SDK over `backend`, on its clock. */
function clientOver(
  backend: MemoryBackend | ReturnType<typeof createTestMemoryBackend>,
  clock: ControlledClock,
): Ticketto {
  let counter = 0;
  return createTicketto({
    backend,
    profile,
    sponsor: { sponsor: async () => ({ ok: true, value: new Uint8Array() as Sponsorship }) },
    operationLifetime: MINUTE,
    now: () => clock.now(),
    randomBytes: (length) => {
      counter += 1;
      return new Uint8Array(length).fill(counter);
    },
  });
}

async function settled(submission: PromiseLike<Result<Receipt>>): Promise<Receipt> {
  const result = await submission;
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const codeOf = (result: Result<unknown>) => (result.ok ? "accepted" : result.error.code);

/** Registers both credentials, creates an event, and issues the holder one ticket per policy. */
async function ticketsFor(
  ticketto: Ticketto,
  policies: readonly AttendancePolicy[],
): Promise<{ event: EventId; tickets: TicketId[] }> {
  for (const who of [organiser, holder]) {
    await settled(
      ticketto.registerCredential(who.signer, {
        account: who.signer.account,
        registration: who.registration,
      }),
    );
  }
  const created = ticketto.createEvent(organiser.signer, {
    salt: new Uint8Array(16).fill(3),
    zones: [{ id: zone, kind: "Unseated" }],
    capacity: null,
    metadata: null,
  });
  await settled(created.submission);
  const tickets: TicketId[] = [];
  for (const [i, policy] of policies.entries()) {
    const issued = ticketto.issueTicket(organiser.signer, {
      event: created.id,
      zone,
      placement: {
        kind: "Unseated",
        discriminator: (i + 1).toString(16).padStart(32, "0") as Discriminator,
      },
      class: "0c" as ClassId,
      provenance: "Purchased",
      policy,
      restrictions: { cannotResale: false, cannotTransfer: false },
      holder: holder.signer.account,
      metadata: null,
    });
    await settled(issued.submission);
    tickets.push(issued.id);
  }
  return { event: created.id, tickets };
}

/** A pass for `ticket`, produced as Saifu produces one, valid from `notBefore` for a minute. */
function passFor(ticket: TicketId, notBefore: Timestamp, id: number): Promise<SignedAccessPass> {
  return producePass(
    {
      ticket,
      holder: holder.signer.account,
      notBefore,
      id: id.toString(16).padStart(32, "0") as PassId,
    },
    holder.signer,
  );
}

describe("AC-B1.4 by clock advance through /testing", () => {
  it("AC-B1.4: a ticket used after its policy's until fails with ERR-TicketExpired", async () => {
    const backend = createTestMemoryBackend({ profile });
    const ticketto = clientOver(backend, backend.clock);
    const until = TEST_EPOCH + 10 * MINUTE;
    const {
      event,
      tickets: [unlimited, multiple],
    } = await ticketsFor(ticketto, [
      { kind: "Unlimited", until },
      { kind: "Multiple", max: 5, until },
    ]);
    const [a, b] = [unlimited as TicketId, multiple as TicketId];

    // At its until, a ticket still admits: canAttend at the ledger's clock, entry at presentation.
    backend.clock.set(until);
    for (const ticket of [a, b]) {
      expect(await ticketto.canAttend(event, ticket)).toEqual({ ok: true, value: { admit: true } });
    }
    const atUntil = await passFor(a, until, 1);
    expect(codeOf(await ticketto.submitAccessPass(atUntil, { presentedAt: until }))).toBe(
      "accepted",
    );

    // One millisecond later, every policy with that until has expired.
    backend.clock.advance(1);
    const now = backend.clock.now();
    for (const [i, ticket] of [a, b].entries()) {
      expect(await ticketto.canAttend(event, ticket)).toEqual({
        ok: true,
        value: { admit: false, reason: "ERR-TicketExpired" },
      });
      const late = await passFor(ticket, now, 10 + i);
      expect(codeOf(await ticketto.submitAccessPass(late, { presentedAt: now }))).toBe(
        "ERR-TicketExpired",
      );
    }
    const attendances = await ticketto.getTicket(a);
    expect(attendances.ok && attendances.value.attendances).toBe(1);
  });
});

interface Deployment {
  readonly clock: ControlledClock;
  readonly store: MemoryStore;
  readonly backend: MemoryBackend;
  readonly ticketto: Ticketto;
}

/** A deployment whose store the test can reach, on a controlled clock shared by the round trip. */
function deployment(clock: ControlledClock): Deployment {
  const store = createMemoryStore({ clock });
  const backend = backendOver(store, profile, publication.signer);
  return { clock, store, backend, ticketto: clientOver(backend, clock) };
}

describe("export and import carry the state no query shows", () => {
  it("REQ-MG-3: an exported pass resubmitted after import is ERR-PassReplayed, or its original receipt when identical", async () => {
    const clock = createControlledClock();
    const source = deployment(clock);
    const {
      tickets: [ticket],
    } = await ticketsFor(source.ticketto, [{ kind: "Unlimited", until: null }]);
    const pass = await passFor(ticket as TicketId, clock.now(), 0x21);
    const presentedAt = clock.now();
    const original = await settled(source.ticketto.submitAccessPass(pass, { presentedAt }));

    const target = deployment(clock);
    const imported = await importVerified(target.backend, source.backend.migration.export(), {
      publication: publication.registration,
    });
    expect(imported).toMatchObject({ ok: true });

    // Identical — the same signed pass and the same presentedAt — within notAfter plus the lag.
    clock.advance(MINUTE / 2);
    expect(await target.ticketto.submitAccessPass(pass, { presentedAt })).toEqual({
      ok: true,
      value: original,
    });
    // The same pass presented again, as a second gate scanning it would: consumed.
    expect(codeOf(await target.ticketto.submitAccessPass(pass, { presentedAt: clock.now() }))).toBe(
      "ERR-PassReplayed",
    );
    const read = await target.ticketto.getTicket(ticket as TicketId);
    expect(read.ok && read.value.attendances).toBe(1);
  });

  it("REQ-MG-3: cancellation holders survive export and import, read through getCancellationHolder", async () => {
    const clock = createControlledClock();
    const source = deployment(clock);
    const {
      event,
      tickets: [moved, kept],
    } = await ticketsFor(source.ticketto, [{ kind: "Single" }, { kind: "Single" }]);
    const [first, second] = [moved as TicketId, kept as TicketId];
    const later = organiser.signer.account;
    // Cancelling (setEventStatus) and transferring are M4 rules, so the store is
    // written as they will write it: the event Cancelled, and one ticket's holder
    // changed afterwards with the lazy snapshot of the holder cancellation fixed.
    await source.store.capabilities.transaction(async (tx) => {
      const record = await tx.getEvent(event);
      if (record === null) throw new Error("no event");
      await tx.putEvent({ ...record, status: "Cancelled" });
      await tx.recordTicketFacts(first, { cancellationHolder: holder.signer.account });
      await tx.setHolder(first, later);
    });

    const target = deployment(clock);
    // importVerified reads every exported cancellation holder back through getCancellationHolder.
    const imported = await importVerified(target.backend, source.backend.migration.export(), {
      publication: publication.registration,
    });
    expect(imported).toMatchObject({ ok: true });
    for (const ticket of [first, second]) {
      expect(await target.ticketto.getCancellationHolder(ticket)).toEqual({
        ok: true,
        value: holder.signer.account,
      });
      expect(await target.ticketto.getCancellationHolder(ticket)).toEqual(
        await source.ticketto.getCancellationHolder(ticket),
      );
    }
    const current = await target.ticketto.getTicket(first);
    expect(current.ok && current.value.holder).toBe(later);
  });
});
