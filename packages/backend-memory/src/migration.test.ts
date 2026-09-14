// T-005-06: export and import (REQ-MG-3; features/005-backend-memory/plan.md §5.6,
// packages/log/FORMAT.md §5).

import { importVerified, readExport, verifyChain } from "@ticketto/log";
import { createProfileV0 } from "@ticketto/profile-v0";
import { softwareP256Signer } from "@ticketto/profile-v0/testing";
import {
  type ClassId,
  createTicketto,
  type Discriminator,
  LOG_START,
  type PassId,
  type Position,
  type Receipt,
  type Result,
  type SignedCommand,
  type Sponsorship,
  type Ticketto,
  type ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { backendOver, type MemoryBackend } from "./backend.js";
import { createMemoryStore, type MemoryStore } from "./capabilities.js";

const profile = createProfileV0({ rpId: "backend-memory.ticketto.test" });
const organiser = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x41) });
const holder = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x42) });
const publication = softwareP256Signer({ secretKey: new Uint8Array(32).fill(0x43) });
const NOW = 1_800_000_000_000;
const LIFETIME = 60_000;

const seated = "5e".repeat(32) as ZoneId;
const unseated = "6e".repeat(32) as ZoneId;
const spare = "7e".repeat(32) as ZoneId;

interface Deployment {
  readonly store: MemoryStore;
  readonly backend: MemoryBackend;
  readonly ticketto: Ticketto;
}

let deployments = 0;

/** A fresh, empty in-memory deployment on a clock the test controls, with its own operation ids. */
function deployment(clock: { now: number } = { now: NOW }): Deployment {
  deployments += 1;
  const base = deployments * 16;
  const store = createMemoryStore({ clock: { now: () => clock.now } });
  const backend = backendOver(store, profile, publication.signer);
  let counter = 0;
  const ticketto = createTicketto({
    backend,
    profile,
    sponsor: { sponsor: async () => ({ ok: true, value: new Uint8Array() as Sponsorship }) },
    operationLifetime: LIFETIME,
    now: () => clock.now,
    randomBytes: (length) => {
      counter += 1;
      return new Uint8Array(length).fill((base + counter) % 256);
    },
  });
  return { store, backend, ticketto };
}

async function settled(submission: PromiseLike<Result<Receipt>>): Promise<Receipt> {
  const result = await submission;
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** Builds some ledger state through the SDK: credentials, an event with zones, and tickets. */
async function populate({ ticketto }: Deployment) {
  for (const who of [organiser, holder]) {
    await settled(
      ticketto.registerCredential(who.signer, {
        account: who.signer.account,
        registration: who.registration,
      }),
    );
  }
  const created = ticketto.createEvent(organiser.signer, {
    salt: new Uint8Array(16).fill(9),
    zones: [
      { id: seated, kind: "Seated" },
      { id: unseated, kind: "Unseated" },
    ],
    capacity: 10,
    metadata: null,
  });
  const createReceipt = await settled(created.submission);
  await settled(
    ticketto.addZone(organiser.signer, { event: created.id, zone: { id: spare, kind: "Seated" } }),
  );
  const common = {
    event: created.id,
    class: "0a0b" as ClassId,
    provenance: "Purchased",
    policy: { kind: "Single" },
    restrictions: { cannotResale: false, cannotTransfer: false },
    holder: holder.signer.account,
    metadata: null,
  } as const;
  const seat = ticketto.issueTicket(organiser.signer, {
    ...common,
    zone: seated,
    placement: { kind: "Seated", position: "a1" as Position },
  });
  await settled(seat.submission);
  const standing = ticketto.issueTicket(organiser.signer, {
    ...common,
    zone: unseated,
    placement: { kind: "Unseated", discriminator: "d1".repeat(16) as Discriminator },
  });
  await settled(standing.submission);
  return { event: created.id, createReceipt, tickets: [seat.id, standing.id] };
}

/** The signed command of the log record at `cursor`, as the port reads it. */
async function commandAt(backend: MemoryBackend, receipt: Receipt): Promise<SignedCommand> {
  const page = await backend.log.read(LOG_START, 1_000);
  if (!page.ok) throw new Error(page.error.code);
  const record = page.value.records.find((r) => r.cursor === receipt.cursor);
  if (record === undefined || !("command" in record.entry)) throw new Error("no command there");
  return record.entry;
}

/** The holder's credential id, as the profile derives it from the registration. */
function holderCredential() {
  const derived = profile.registrationAccount(holder.registration);
  if (!derived.ok) throw new Error(derived.error.code);
  return derived.value.credential;
}

async function bytesOf(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of stream) out.push(...chunk);
  return out;
}

describe("in-memory backend: export and import", () => {
  it("REQ-MG-3: export from one instance, import into another, identical observable state", async () => {
    const source = deployment();
    const { event, tickets } = await populate(source);
    const target = deployment();

    const imported = await importVerified(target.backend, source.backend.migration.export(), {
      publication: publication.registration,
      pageSize: 2,
    });
    expect(imported).toMatchObject({ ok: true });

    // The same state exports to the same bytes, from either instance.
    expect(await bytesOf(target.backend.migration.export())).toEqual(
      await bytesOf(source.backend.migration.export()),
    );
    for (const query of [
      { kind: "getEvent", event },
      { kind: "getTicket", ticket: tickets[0] },
      { kind: "getTicket", ticket: tickets[1] },
      { kind: "getCredential", account: holder.signer.account, credential: holderCredential() },
    ] as const) {
      expect(await target.backend.query(query as never)).toEqual(
        await source.backend.query(query as never),
      );
    }
    const credential = await target.backend.query({
      kind: "getCredential",
      account: holder.signer.account,
      credential: holderCredential(),
    });
    expect(credential).toEqual({ ok: true, value: holder.registration });
    expect(await target.backend.log.read(LOG_START, 1_000)).toEqual(
      await source.backend.log.read(LOG_START, 1_000),
    );
  });

  it("REQ-CM-1: an exported command resubmitted after import returns its original receipt", async () => {
    const source = deployment();
    const { createReceipt } = await populate(source);
    const target = deployment();
    expect(await target.backend.migration.import(source.backend.migration.export())).toEqual({
      ok: true,
    });

    const signed = await commandAt(source.backend, createReceipt);
    const replay = await target.backend.submit({ kind: "command", signed });
    // The receipt is re-rendered from the recorded sequence, and nothing is written.
    expect(replay).toEqual({ ok: true, value: createReceipt });
    expect(target.store.records()).toHaveLength(source.store.records().length);
  });

  it("recomputes each event's zones in use from its tickets on import", async () => {
    const source = deployment();
    const { event } = await populate(source);
    const target = deployment();
    await target.backend.migration.import(source.backend.migration.export());

    const zones = async (store: MemoryStore) =>
      [...((await store.capabilities.registry.getEvent(event))?.zonesInUse ?? [])].sort();
    expect(await zones(target.store)).toEqual([seated, unseated].sort());
    expect(await zones(target.store)).toEqual(await zones(source.store));

    // The rules see them: a zone in use cannot be removed; an unused one can.
    const inUse = await target.ticketto.removeZone(organiser.signer, { event, zone: seated });
    expect(inUse.ok ? null : inUse.error.code).toBe("ERR-ZoneInUse");
    expect((await target.ticketto.removeZone(organiser.signer, { event, zone: spare })).ok).toBe(
      true,
    );
  });

  it("continues the imported chain: the next write links onto the exported head", async () => {
    const source = deployment();
    const { event } = await populate(source);
    const target = deployment();
    await target.backend.migration.import(source.backend.migration.export());

    const hints = target.backend.log.hints()[Symbol.asyncIterator]();
    expect((await hints.next()).value).toBe(source.store.records().at(-1)?.record.cursor);
    await hints.return?.();

    await settled(target.ticketto.removeZone(organiser.signer, { event, zone: spare }));
    const records = target.store.records();
    expect(records).toHaveLength(source.store.records().length + 1);
    expect(verifyChain(records.map(({ linked }) => linked.bytes)).ok).toBe(true);
  });

  it("carries consumed passes within their retention, and operations within their expiry", async () => {
    const clock = { now: NOW };
    const source = deployment(clock);
    const { createReceipt, tickets } = await populate(source);
    const [ticket] = tickets as [(typeof tickets)[0]];
    const pass = { ticket, id: "01".repeat(16) as PassId };
    const expired = { ticket, id: "02".repeat(16) as PassId };
    await source.store.capabilities.transaction(async (tx) => {
      await tx.recordConsumedPass(pass.ticket, pass.id, NOW + 1_000);
      await tx.recordConsumedPass(expired.ticket, expired.id, NOW - 1);
    });

    const ledger = await readExport(source.backend.migration.export());
    if (!ledger.ok) throw new Error(ledger.detail);
    expect(ledger.ledger.snapshot.consumedPasses).toEqual([
      { ticket: pass.ticket, pass: pass.id, retainUntil: NOW + 1_000 },
    ]);
    expect(ledger.ledger.snapshot.operations.map((o) => o.operationId)).toContain(
      createReceipt.operationId,
    );

    const target = deployment(clock);
    await target.backend.migration.import(source.backend.migration.export());
    const registry = target.store.capabilities.registry;
    expect(await registry.isPassConsumed(pass.ticket, pass.id)).toBe(true);
    expect(await registry.isPassConsumed(expired.ticket, expired.id)).toBe(false);
    expect(await registry.getOperation(createReceipt.operationId)).toEqual(
      await source.store.capabilities.registry.getOperation(createReceipt.operationId),
    );

    // Past every command's expiry, no operation is carried any longer.
    clock.now = NOW + LIFETIME + 1;
    const later = await readExport(source.backend.migration.export());
    expect(later.ok && later.ledger.snapshot.operations).toEqual([]);
  });

  it("carries the cancellation holder of every ticket of a cancelled event", async () => {
    const source = deployment();
    const { event, tickets } = await populate(source);
    const [first, second] = tickets as [(typeof tickets)[0], (typeof tickets)[0]];
    const other = organiser.signer.account;
    await source.store.capabilities.transaction(async (tx) => {
      const record = await tx.getEvent(event);
      if (record === null) throw new Error("no event");
      await tx.putEvent({ ...record, status: "Cancelled" });
      // One ticket changed holder after cancellation, snapshotting the holder it fixed.
      await tx.recordTicketFacts(first, { cancellationHolder: holder.signer.account });
      await tx.setHolder(first, other);
    });

    const ledger = await readExport(source.backend.migration.export());
    if (!ledger.ok) throw new Error(ledger.detail);
    expect(
      [...ledger.ledger.snapshot.cancellationHolders].sort((a, b) =>
        a.ticket < b.ticket ? -1 : 1,
      ),
    ).toEqual(
      [
        { ticket: first, holder: holder.signer.account },
        { ticket: second, holder: holder.signer.account },
      ].sort((a, b) => (a.ticket < b.ticket ? -1 : 1)),
    );

    const target = deployment();
    expect(await target.backend.migration.import(source.backend.migration.export())).toEqual({
      ok: true,
    });
    const registry = target.store.capabilities.registry;
    expect((await registry.getTicket(first))?.cancellationHolder).toBe(holder.signer.account);
    expect((await registry.getTicket(first))?.holder).toBe(other);
    expect((await registry.getTicket(second))?.cancellationHolder).toBe(holder.signer.account);
  });

  it("round-trips an empty ledger, which needs no publication key", async () => {
    const store = createMemoryStore({ clock: { now: () => NOW } });
    const empty = backendOver(store, profile);
    const target = deployment();
    expect(await importVerified(target.backend, empty.migration.export())).toMatchObject({
      ok: true,
    });
    expect(target.store.isEmpty()).toBe(true);
  });

  it("refuses to export a non-empty log without the publication key", async () => {
    const source = deployment();
    await populate(source);
    const unsigned = backendOver(source.store, profile);
    await expect(bytesOf(unsigned.migration.export())).rejects.toThrow("publication key");
  });

  it("imports only into an empty backend, and refuses a malformed export, changing nothing", async () => {
    const source = deployment();
    await populate(source);
    const exported = await bytesOf(source.backend.migration.export());
    async function* stream(bytes: number[]) {
      yield Uint8Array.from(bytes);
    }

    expect(await source.backend.migration.import(stream(exported))).toMatchObject({
      ok: false,
      reason: "notEmpty",
    });

    const target = deployment();
    const tampered = [...exported];
    tampered[40] = (tampered[40] ?? 0) ^ 0xff;
    expect(await target.backend.migration.import(stream(tampered))).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(target.store.isEmpty()).toBe(true);
    expect(await target.backend.migration.import(stream(exported))).toEqual({ ok: true });
  });
});
