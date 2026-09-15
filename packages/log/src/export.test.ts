// T-006-04 — export stream and snapshot format; import driver with
// observable-state verification (REQ-MG-3, REQ-MG-2; plan §5.5).
//
// Done when: a round trip through a reference `migration` store in this
// package's tests verifies, and a tampered record, snapshot entry or head hash
// fails verification. No backend is involved: the store is test/reference-store.ts.

import {
  blake2b256,
  commandSigningPayload,
  encodeSignedAccessPass,
  encodeSignedCommand,
  registrationAccount,
} from "@ticketto/profile-v0";
import type {
  AccountId,
  Backend,
  ClassId,
  Command,
  CredentialId,
  Event,
  EventId,
  OperationId,
  PassId,
  Registration,
  SignedCommand,
  Signer,
  Ticket,
} from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import {
  COMMANDS,
  event,
  holder,
  organiser,
  placement,
  publication,
  samplePass,
  ticket,
  zone,
} from "../test/fixtures.js";
import { referenceStore } from "../test/reference-store.js";
import { concatBytes } from "./bytes.js";
import {
  decodeRecord,
  EXPORT_ITEM_TAG,
  EXPORT_MAGIC,
  encodeExport,
  exportStream,
  importVerified,
  type LedgerExport,
  type LedgerSnapshot,
  LogChain,
  type LogEntry,
  operationDigest,
  readExport,
  verifyImport,
} from "./index.js";

const other = "ee".repeat(32) as EventId;
const receiver = "99".repeat(32) as AccountId;

async function sign(command: Command, signer: Signer): Promise<SignedCommand> {
  return { command, authorisation: await signer.sign(commandSigningPayload(command)) };
}

function credentialOf(registration: Registration) {
  const derived = registrationAccount(registration);
  if (!derived.ok) throw new Error("fixture registration does not derive");
  return { ...derived.value, registration };
}

let seed: { records: Uint8Array[]; snapshot: LedgerSnapshot };

beforeAll(async () => {
  const commands: [Command, Signer][] = [
    [COMMANDS.registerCredential, holder.signer],
    [
      {
        ...COMMANDS.registerCredential,
        operationId: "0a".repeat(16),
        account: organiser.signer.account,
        registration: organiser.registration,
      } as Command,
      organiser.signer,
    ],
    [COMMANDS.createEvent, organiser.signer],
    [COMMANDS.issueTicket, organiser.signer],
    [COMMANDS.removeRestriction, organiser.signer],
    [{ ...COMMANDS.setEventStatus, status: "Cancelled" } as Command, organiser.signer],
    [COMMANDS.transferTicket, organiser.signer],
  ];
  const chain = new LogChain();
  const records: Uint8Array[] = [];
  const operations = [];
  for (const [command, signer] of commands) {
    const signed = await sign(command, signer);
    const entry: LogEntry = {
      recordedAt: 1_800_000_000_000 + records.length,
      event: "event" in command ? command.event : null,
      entry: signed,
      presentedAt: null,
    };
    const linked = chain.append(entry);
    operations.push({
      operationId: command.operationId,
      expiresAt: command.expiresAt,
      digest: blake2b256(encodeSignedCommand(signed)),
      sequence: linked.record.sequence,
    });
    records.push(linked.bytes);
  }
  // An access pass is an operation too, under its pass id, with its C3 pass digest.
  const pass = await samplePass();
  const presentedAt = 1_800_000_000_000;
  const passRecord = chain.append({
    recordedAt: 1_800_000_000_100,
    event,
    entry: pass,
    presentedAt,
  });
  records.push(passRecord.bytes);
  const retainUntil = pass.pass.notAfter + 300_000;
  operations.push({
    operationId: pass.pass.id as string as OperationId,
    expiresAt: retainUntil,
    digest: operationDigest(pass, presentedAt),
    sequence: passRecord.record.sequence,
  });

  const events: Event[] = [
    {
      id: event,
      owner: organiser.signer.account,
      status: "Cancelled",
      maxCapacity: 100,
      issued: 1,
      zones: [{ id: zone, kind: "Unseated" }],
    },
    {
      id: other,
      owner: organiser.signer.account,
      status: "Active",
      maxCapacity: null,
      issued: 0,
      zones: [],
    },
  ];
  const tickets: Ticket[] = [
    {
      id: ticket,
      event,
      holder: receiver,
      class: "0a0b" as ClassId,
      provenance: "Granted",
      zone,
      placement,
      policy: { kind: "Multiple", max: 3, until: null },
      restrictions: { cannotResale: false, cannotTransfer: false },
      attendances: 1,
    },
  ];
  seed = {
    records,
    snapshot: {
      events,
      tickets,
      credentials: [credentialOf(holder.registration), credentialOf(organiser.registration)],
      cancellationHolders: [{ ticket, holder: holder.signer.account }],
      consumedPasses: [{ ticket, pass: pass.pass.id, retainUntil }],
      operations,
    },
  };
});

const source = () => referenceStore(publication.signer, seed);
const target = () => referenceStore(publication.signer);

async function bytesOf(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return concatBytes(...chunks);
}

async function* chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

async function* of(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* chunks;
}

/** The source store's export, read back. */
async function exported(): Promise<LedgerExport> {
  const read = await readExport(source().migration?.export() ?? of(), {
    publication: publication.registration,
  });
  if (!read.ok) throw new Error(`fixture export is malformed: ${read.detail}`);
  return read.ledger;
}

/** A target store holding what `ledger` holds, imported verbatim. */
async function imported(ledger: LedgerExport): Promise<ReturnType<typeof target>> {
  const store = target();
  const result = await store.migration?.import(exportStream(ledger));
  expect(result).toEqual({ ok: true });
  return store;
}

describe("T-006-04 round trip through a reference migration store (REQ-MG-3)", () => {
  it("imports an export and verifies the target's observable state against it", async () => {
    const into = target();
    const outcome = await importVerified(into, source().migration?.export() ?? of(), {
      publication: publication.registration,
      pageSize: 3,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ledger.records).toHaveLength(8);
    expect(outcome.ledger.snapshot.cancellationHolders).toHaveLength(1);
    // Identifiers are carried as they are (REQ-MG-2), and the target exports the same bytes.
    expect(await bytesOf(into.migration?.export() ?? of())).toEqual(
      await bytesOf(source().migration?.export() ?? of()),
    );
  });

  it("round-trips an empty ledger, which has no checkpoint", async () => {
    const empty = target();
    const outcome = await importVerified(target(), empty.migration?.export() ?? of());
    expect(outcome).toMatchObject({ ok: true, ledger: { records: [], checkpoint: null } });
  });

  it("reads the same export however the stream is chunked", async () => {
    const bytes = await bytesOf(source().migration?.export() ?? of());
    const whole = await readExport(of(bytes));
    for (const size of [1, 7, 64]) expect(await readExport(chunked(bytes, size))).toEqual(whole);
  });

  it("exports equal state to equal bytes, whatever order the store lists it in", async () => {
    const ledger = await exported();
    const shuffled: LedgerExport = {
      ...ledger,
      snapshot: {
        ...ledger.snapshot,
        events: [...ledger.snapshot.events].reverse(),
        operations: [...ledger.snapshot.operations].reverse(),
      },
    };
    expect(concatBytes(...encodeExport(shuffled))).toEqual(concatBytes(...encodeExport(ledger)));
  });

  it("refuses to import into a backend that is not empty, or has no migration", async () => {
    const stream = source().migration?.export() ?? of();
    expect(await importVerified(source(), stream)).toEqual({
      ok: false,
      failure: { ok: false, reason: "notEmpty" },
    });
    const { migration: _, ...bare } = source();
    expect(await importVerified(bare as Backend, of())).toMatchObject({
      ok: false,
      failure: { reason: "unsupported" },
    });
  });
});

describe("T-006-04 a tampered record fails", () => {
  it("in the stream: refused as malformed, before the backend sees it", async () => {
    const bytes = await bytesOf(source().migration?.export() ?? of());
    // A byte inside the first record's recordedAt.
    // Header, then the first item's tag and two-byte length; recordedAt is at 10.
    const offset = EXPORT_MAGIC.length + 1 + 3 + 10;
    const tampered = bytes.slice();
    tampered[offset] = (tampered[offset] ?? 0) ^ 1;
    const into = target();
    const outcome = await importVerified(into, of(tampered));
    expect(outcome).toMatchObject({ ok: false, failure: { reason: "malformed" } });
    expect(into.state.records).toEqual([]);
  });

  it("in the backend: the log no longer re-links into the exported records", async () => {
    const ledger = await exported();
    const store = await imported(ledger);
    const [first, second] = [store.state.records[1], store.state.records[2]];
    if (first === undefined || second === undefined) throw new Error("fixture too short");
    store.state.records[1] = second;
    store.state.records[2] = first;
    expect(await verifyImport(store, ledger)).toMatchObject({ ok: false, mismatch: "log" });
  });

  it("in the backend: a record dropped from the end", async () => {
    const ledger = await exported();
    const store = await imported(ledger);
    store.state.records.pop();
    expect(await verifyImport(store, ledger)).toMatchObject({ ok: false, mismatch: "log" });
  });

  it("in the backend: a record changed in place", async () => {
    const ledger = await exported();
    const store = await imported(ledger);
    const changed = (store.state.records[0] as Uint8Array).slice();
    // recordedAt, at offset 10 of a record with no event: it still decodes, but no longer links.
    changed[10] = (changed[10] ?? 0) ^ 1;
    store.state.records[0] = changed;
    expect(await verifyImport(store, ledger)).toMatchObject({ ok: false, mismatch: "log" });
  });
});

describe("T-006-04 a tampered snapshot entry fails", () => {
  it("a ticket loaded differently from the export", async () => {
    const ledger = await exported();
    const tampered: LedgerExport = {
      ...ledger,
      snapshot: {
        ...ledger.snapshot,
        tickets: ledger.snapshot.tickets.map((t) => ({ ...t, attendances: t.attendances + 1 })),
      },
    };
    // The tampered stream is well formed, and imports; verification against the export fails.
    const store = await imported(tampered);
    expect(await verifyImport(store, tampered)).toEqual({ ok: true });
    expect(await verifyImport(store, ledger)).toMatchObject({ ok: false, mismatch: "ticket" });
  });

  it("an event, a credential, or a cancellation holder changed in the backend", async () => {
    const ledger = await exported();

    const eventStore = await imported(ledger);
    const stored = eventStore.state.events.get(event) as Event;
    eventStore.state.events.set(event, { ...stored, issued: 2 });
    expect(await verifyImport(eventStore, ledger)).toMatchObject({ ok: false, mismatch: "event" });

    const credentialStore = await imported(ledger);
    credentialStore.state.credentials = credentialStore.state.credentials.map((c) => ({
      ...c,
      credential: "ff" as CredentialId,
    }));
    expect(await verifyImport(credentialStore, ledger)).toMatchObject({
      ok: false,
      mismatch: "credential",
    });

    const holderStore = await imported(ledger);
    holderStore.state.cancellationHolders.set(ticket, { ticket, holder: receiver });
    expect(await verifyImport(holderStore, ledger)).toMatchObject({
      ok: false,
      mismatch: "cancellationHolder",
    });
  });

  it("an entry missing from the backend", async () => {
    const ledger = await exported();
    const store = await imported(ledger);
    store.state.tickets.clear();
    expect(await verifyImport(store, ledger)).toMatchObject({ ok: false, mismatch: "ticket" });
  });
});

describe("T-006-04 a tampered head hash fails", () => {
  it("against the backend: the log does not end at the checkpoint's head hash", async () => {
    const ledger = await exported();
    const store = await imported(ledger);
    const checkpoint = ledger.checkpoint;
    if (checkpoint === null) throw new Error("fixture has no checkpoint");
    const tampered = { ...ledger, checkpoint: { ...checkpoint, headHash: "00".repeat(32) } };
    expect(await verifyImport(store, tampered)).toMatchObject({ ok: false, mismatch: "head" });
  });

  it("in the stream: a checkpoint that is not the chain's head, or not the publication key's", async () => {
    const ledger = await exported();
    const checkpoint = ledger.checkpoint;
    if (checkpoint === null) throw new Error("fixture has no checkpoint");
    const wrongHead = { ...ledger, checkpoint: { ...checkpoint, headHash: "00".repeat(32) } };
    expect(await readExport(exportStream(wrongHead))).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: expect.stringContaining("checkpoint"),
    });
    const wrongSequence = { ...ledger, checkpoint: { ...checkpoint, sequence: 0 } };
    expect(await readExport(exportStream(wrongSequence))).toMatchObject({ reason: "malformed" });
    // Re-signed consistently by another key: refused only against the publication key.
    expect(
      await readExport(exportStream(ledger), { publication: organiser.registration }),
    ).toMatchObject({ reason: "malformed" });
  });
});

describe("T-006-04 export format", () => {
  it("starts with the magic and version, then tagged, length-prefixed items, and ends with counts", async () => {
    const ledger = await exported();
    const chunks = encodeExport(ledger);
    expect(new TextDecoder().decode(chunks[0])).toBe(`${EXPORT_MAGIC}\u0000`);
    expect(chunks[1]?.[0]).toBe(EXPORT_ITEM_TAG.record);
    const end = chunks.at(-1) as Uint8Array;
    // Counts: 8 records, 1 checkpoint, 2 events, 1 ticket, 2 credentials, 1 holder, 1 pass, 8 operations.
    expect([...end]).toEqual([0, 8 << 2, ...[8, 1, 2, 1, 2, 1, 1, 8].map((n) => n << 2)]);
    expect(chunks).toHaveLength(1 + 8 + 1 + 2 + 1 + 2 + 1 + 1 + 8 + 1);
  });

  it("refuses an encoding whose checkpoint and records disagree, or whose credential is not its registration's", async () => {
    const ledger = await exported();
    expect(() => encodeExport({ ...ledger, checkpoint: null })).toThrow(TypeError);
    const [credential] = ledger.snapshot.credentials;
    if (credential === undefined) throw new Error("fixture has no credential");
    expect(() =>
      encodeExport({
        ...ledger,
        snapshot: {
          ...ledger.snapshot,
          credentials: [{ ...credential, account: receiver }],
        },
      }),
    ).toThrow(TypeError);
  });

  const malformed: [string, (chunks: Uint8Array[]) => Uint8Array[]][] = [
    [
      "another magic",
      (c) => [
        Uint8Array.from([...(c[0] as Uint8Array)].map((b, i) => (i === 0 ? b ^ 1 : b))),
        ...c.slice(1),
      ],
    ],
    [
      "another version",
      (c) => [concatBytes((c[0] as Uint8Array).subarray(0, -1), Uint8Array.of(1)), ...c.slice(1)],
    ],
    ["no end item", (c) => c.slice(0, -1)],
    ["an item after the end", (c) => [...c, c[1] as Uint8Array]],
    ["a truncated item", (c) => [...c.slice(0, -1), (c.at(-1) as Uint8Array).subarray(0, 2)]],
    ["an item left out", (c) => [...c.slice(0, 11), ...c.slice(12)]],
    [
      "sections out of order",
      (c) => [c[0] as Uint8Array, c[9] as Uint8Array, ...c.slice(1, 9), ...c.slice(10)],
    ],
    [
      "events out of order",
      (c) => [...c.slice(0, 10), c[11] as Uint8Array, c[10] as Uint8Array, ...c.slice(12)],
    ],
    [
      "an unknown item tag",
      (c) => [...c.slice(0, -1), Uint8Array.of(9, 0), c.at(-1) as Uint8Array],
    ],
  ];
  for (const [name, change] of malformed) {
    it(`refuses a stream with ${name}`, async () => {
      const chunks = encodeExport(await exported());
      expect(await readExport(of(...change(chunks)))).toMatchObject({
        ok: false,
        reason: "malformed",
      });
    });
  }

  it("carries a pass operation under its pass id, with the pass digest over presentedAt", async () => {
    const ledger = await exported();
    const passOperation = ledger.snapshot.operations.find((o) => o.sequence === 7);
    expect(passOperation).toBeDefined();
    const record = decodeRecord(ledger.records[7] as Uint8Array);
    if (!("pass" in record.input) || passOperation === undefined) throw new Error("fixture");
    expect(passOperation.operationId).toBe(record.input.pass.id);
    // BLAKE2b-256(signed-pass framing ‖ presentedAt as u64 little-endian).
    const presentedAt = new Uint8Array(8);
    new DataView(presentedAt.buffer).setBigUint64(0, BigInt(record.presentedAt ?? 0), true);
    expect(passOperation.digest).toEqual(
      blake2b256(concatBytes(encodeSignedAccessPass(record.input), presentedAt)),
    );
  });

  it("refuses a snapshot whose parts disagree", async () => {
    const ledger = await exported();
    const { snapshot } = ledger;
    const pass = decodeRecord(ledger.records[7] as Uint8Array);
    const withPassOperation = (change: Partial<(typeof snapshot.operations)[number]>) => ({
      ...snapshot,
      operations: snapshot.operations.map((o) => (o.sequence === 7 ? { ...o, ...change } : o)),
    });
    const variants: LedgerSnapshot[] = [
      { ...snapshot, cancellationHolders: [] },
      {
        ...snapshot,
        cancellationHolders: [
          ...snapshot.cancellationHolders,
          { ticket: "12".repeat(32), holder: receiver } as never,
        ],
      },
      { ...snapshot, events: snapshot.events.filter((e) => e.id !== event) },
      {
        ...snapshot,
        consumedPasses: [
          { ticket: "34".repeat(32), pass: "ab".repeat(16) as PassId, retainUntil: 0 } as never,
        ],
      },
      {
        ...snapshot,
        operations: snapshot.operations.map((o, i) => (i === 0 ? { ...o, sequence: 7 } : o)),
      },
      {
        ...snapshot,
        operations: snapshot.operations.map((o, i) =>
          i === 0 ? { ...o, digest: new Uint8Array(32) } : o,
        ),
      },
      { ...snapshot, credentials: [...snapshot.credentials, ...snapshot.credentials.slice(0, 1)] },
      // A pass operation whose digest omits presentedAt, or covers another one.
      withPassOperation({ digest: blake2b256(encodeSignedAccessPass(pass.input as never)) }),
      withPassOperation({
        digest: operationDigest(pass.input, (pass.presentedAt ?? 0) + 1),
      }),
      // A pass operation naming a command record, or under an id other than its pass id.
      withPassOperation({ sequence: 0 }),
      withPassOperation({ operationId: "cd".repeat(16) as OperationId }),
    ];
    for (const variant of variants) {
      expect(await readExport(exportStream({ ...ledger, snapshot: variant }))).toMatchObject({
        ok: false,
        reason: "malformed",
      });
    }
  });
});
