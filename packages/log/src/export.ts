// The export stream and snapshot format (C7; features/006-log-and-export/plan.md
// §5.5, REQ-MG-3, REQ-MG-2).
//
//   Export = "ticketto/v0/export", version u8 = 0, Item*
//   Item   = tag u8, body Vec<u8>
//
// An export carries the log's records up to a checkpoint, that checkpoint, and a
// snapshot of ledger state at it. Sections come in tag order — records,
// checkpoint, events, tickets, credentials, cancellation holders, consumed
// passes, operations — each sorted by its key, and an `end` item closes the
// stream with every section's count, so a truncated export is refused rather
// than imported short. The same state therefore always exports to the same
// bytes.
//
// Nothing derivable is carried: a backend recomputes its own bookkeeping (an
// event's zones in use) from the tickets, a credential's account and id come
// from its registration through the profile, and no cursor is exported — a
// cursor is a backend's rendering of a sequence, and a receipt is re-rendered
// from the sequence of its record.
//
// A chunk of the stream is not a unit of the format: a reader accepts the bytes
// however they are split.

import { blake2b256, codecs, encodeSignedCommand, registrationAccount } from "@ticketto/profile-v0";
import type {
  AccountId,
  CredentialId,
  Event,
  MigrationFailure,
  OperationId,
  PassId,
  Registration,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";
import { ascii, concatBytes, equalBytes } from "./bytes.js";
import { verifyChain } from "./chain.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  verifyCheckpoint,
} from "./checkpoint.js";
import { type ChainedRecord, decodeRecord, HASH_LENGTH } from "./record.js";
import { LogDecodeError, Reader, Writer } from "./scale.js";

/** The ASCII magic an export starts with. */
export const EXPORT_MAGIC = "ticketto/v0/export";

/** The export format version following the magic. */
export const EXPORT_VERSION = 0;

/** Each item's tag, in the order sections appear. */
export const EXPORT_ITEM_TAG = {
  end: 0,
  record: 1,
  checkpoint: 2,
  event: 3,
  ticket: 4,
  credential: 5,
  cancellationHolder: 6,
  consumedPass: 7,
  operation: 8,
} as const;

/** A credential registered to an account (`REQ-CP-6`, `REQ-MG-6`). */
export interface ExportedCredential {
  /** Derived from `registration` through the profile; not carried in the stream. */
  readonly account: AccountId;
  /** Derived from `registration` through the profile; not carried in the stream. */
  readonly credential: CredentialId;
  readonly registration: Registration;
}

/** The holder fixed for a ticket of a cancelled event (`REQ-EV-10`). */
export interface ExportedCancellationHolder {
  readonly ticket: TicketId;
  readonly holder: AccountId;
}

/** A pass id consumed for a ticket, still within its retention (`INV-6`, `AD-13`). */
export interface ExportedConsumedPass {
  readonly ticket: TicketId;
  readonly pass: PassId;
  readonly retainUntil: Timestamp;
}

/** An operation id still within its expiry (`REQ-CM-1`, `AD-15`). */
export interface ExportedOperation {
  readonly operationId: OperationId;
  readonly expiresAt: Timestamp;
  /** BLAKE2b-256 of the recorded command's signed-input framing (`C3`). */
  readonly digest: Uint8Array;
  /** The sequence of the record the operation produced; its receipt is re-rendered from it. */
  readonly sequence: number;
}

/** Ledger state at an export's checkpoint. */
export interface LedgerSnapshot {
  readonly events: readonly Event[];
  readonly tickets: readonly Ticket[];
  /** Grouped by account; within an account, in registration order. */
  readonly credentials: readonly ExportedCredential[];
  /** One for every ticket of a `Cancelled` event, and no other. */
  readonly cancellationHolders: readonly ExportedCancellationHolder[];
  readonly consumedPasses: readonly ExportedConsumedPass[];
  readonly operations: readonly ExportedOperation[];
}

/** A complete export: the records up to a checkpoint, the checkpoint, and the snapshot at it. */
export interface LedgerExport {
  /** Every record's canonical bytes (`C7` §2), from sequence 0. */
  readonly records: readonly Uint8Array[];
  /** The checkpoint at the last record; `null` exactly when there are no records. */
  readonly checkpoint: Checkpoint | null;
  readonly snapshot: LedgerSnapshot;
}

// --- Item bodies -------------------------------------------------------------

function writeEvent(w: Writer, event: Event): void {
  w.codec(codecs.eventId, event.id)
    .codec(codecs.accountId, event.owner)
    .codec(codecs.eventStatus, event.status)
    .option(event.maxCapacity, (o, capacity) => {
      o.compact(capacity);
    })
    .compact(event.issued)
    .compact(event.zones.length);
  for (const zone of event.zones) w.codec(codecs.zone, zone);
}

function readEvent(r: Reader): Event {
  const id = r.codec(codecs.eventId, "event.id");
  const owner = r.codec(codecs.accountId, "event.owner");
  const status = r.codec(codecs.eventStatus, "event.status");
  const maxCapacity = r.option((o) => o.compact());
  const issued = r.compact();
  const count = r.compact();
  if (count > r.remaining) throw new LogDecodeError("event.zones: length exceeds input");
  const zones = [];
  for (let i = 0; i < count; i++) zones.push(r.codec(codecs.zone, "event.zones"));
  return { id, owner, status, maxCapacity, issued, zones };
}

function writeTicket(w: Writer, ticket: Ticket): void {
  w.codec(codecs.ticketId, ticket.id)
    .codec(codecs.eventId, ticket.event)
    .codec(codecs.accountId, ticket.holder)
    .codec(codecs.classId, ticket.class)
    .codec(codecs.provenance, ticket.provenance)
    .codec(codecs.zoneId, ticket.zone)
    .codec(codecs.placement, ticket.placement)
    .codec(codecs.attendancePolicy, ticket.policy)
    .codec(codecs.ticketRestrictions, ticket.restrictions)
    .compact(ticket.attendances);
}

function readTicket(r: Reader): Ticket {
  return {
    id: r.codec(codecs.ticketId, "ticket.id"),
    event: r.codec(codecs.eventId, "ticket.event"),
    holder: r.codec(codecs.accountId, "ticket.holder"),
    class: r.codec(codecs.classId, "ticket.class"),
    provenance: r.codec(codecs.provenance, "ticket.provenance"),
    zone: r.codec(codecs.zoneId, "ticket.zone"),
    placement: r.codec(codecs.placement, "ticket.placement"),
    policy: r.codec(codecs.attendancePolicy, "ticket.policy"),
    restrictions: r.codec(codecs.ticketRestrictions, "ticket.restrictions"),
    attendances: r.compact(),
  };
}

/** A body's canonical bytes. Throws `TypeError` for a value that cannot be encoded. */
function body(write: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  write(w);
  return w.finish();
}

/** Decodes a whole body, refusing trailing bytes. */
function parse<T>(bytes: Uint8Array, read: (r: Reader) => T): T {
  const r = new Reader(bytes);
  const value = read(r);
  r.end();
  return value;
}

/** The canonical bytes of an event as an export carries it, and as `getEvent` is compared. */
export function encodeSnapshotEvent(event: Event): Uint8Array {
  return body((w) => writeEvent(w, event));
}

/** The canonical bytes of a ticket as an export carries it, and as `getTicket` is compared. */
export function encodeSnapshotTicket(ticket: Ticket): Uint8Array {
  return body((w) => writeTicket(w, ticket));
}

// --- Ordering ----------------------------------------------------------------

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const credentialKey = (c: ExportedCredential) => c.account;
const passKey = (p: ExportedConsumedPass) => `${p.ticket}:${p.pass}`;

// --- Writing -----------------------------------------------------------------

function item(tag: number, bytes: Uint8Array): Uint8Array {
  return new Writer().u8(tag).bytes(bytes).finish();
}

/**
 * Encodes `ledger` as an export stream, one item per chunk. Sorts every snapshot
 * section by its key — credentials by account, keeping each account's
 * registration order — so equal state always exports to equal bytes.
 *
 * Throws `TypeError` for an export whose parts cannot be encoded or disagree on
 * their face: a checkpoint present without records or absent with them, or a
 * credential whose account or id is not the one its registration derives.
 * Everything else is the reader's to check (`readExport`).
 */
export function encodeExport(ledger: LedgerExport): Uint8Array[] {
  const { records, checkpoint, snapshot } = ledger;
  if ((checkpoint === null) !== (records.length === 0)) {
    throw new TypeError("an export has a checkpoint exactly when it has records");
  }
  for (const credential of snapshot.credentials) {
    const derived = registrationAccount(credential.registration);
    if (
      !derived.ok ||
      derived.value.account !== credential.account ||
      derived.value.credential !== credential.credential
    ) {
      throw new TypeError("a credential's account and id are the ones its registration derives");
    }
  }
  const tag = EXPORT_ITEM_TAG;
  const chunks: Uint8Array[] = [new Writer().raw(ascii(EXPORT_MAGIC)).u8(EXPORT_VERSION).finish()];
  for (const record of records) chunks.push(item(tag.record, record));
  if (checkpoint !== null) chunks.push(item(tag.checkpoint, encodeCheckpoint(checkpoint)));
  const sorted = <T>(list: readonly T[], key: (value: T) => string) =>
    [...list].sort((a, b) => compare(key(a), key(b)));
  for (const event of sorted(snapshot.events, (e) => e.id)) {
    chunks.push(item(tag.event, encodeSnapshotEvent(event)));
  }
  for (const ticket of sorted(snapshot.tickets, (t) => t.id)) {
    chunks.push(item(tag.ticket, encodeSnapshotTicket(ticket)));
  }
  for (const credential of sorted(snapshot.credentials, credentialKey)) {
    chunks.push(
      item(
        tag.credential,
        body((w) => w.bytes(credential.registration)),
      ),
    );
  }
  for (const entry of sorted(snapshot.cancellationHolders, (c) => c.ticket)) {
    const bytes = body((w) =>
      w.codec(codecs.ticketId, entry.ticket).codec(codecs.accountId, entry.holder),
    );
    chunks.push(item(tag.cancellationHolder, bytes));
  }
  for (const entry of sorted(snapshot.consumedPasses, passKey)) {
    const bytes = body((w) =>
      w
        .codec(codecs.ticketId, entry.ticket)
        .codec(codecs.passId, entry.pass)
        .u64(entry.retainUntil, "retainUntil"),
    );
    chunks.push(item(tag.consumedPass, bytes));
  }
  for (const entry of sorted(snapshot.operations, (o) => o.operationId)) {
    const bytes = body((w) =>
      w
        .codec(codecs.operationId, entry.operationId)
        .u64(entry.expiresAt, "expiresAt")
        .fixed(entry.digest, HASH_LENGTH, "digest")
        .u64(entry.sequence, "sequence"),
    );
    chunks.push(item(tag.operation, bytes));
  }
  const counts = [
    records.length,
    checkpoint === null ? 0 : 1,
    snapshot.events.length,
    snapshot.tickets.length,
    snapshot.credentials.length,
    snapshot.cancellationHolders.length,
    snapshot.consumedPasses.length,
    snapshot.operations.length,
  ];
  chunks.push(
    item(
      tag.end,
      body((w) => {
        for (const count of counts) w.compact(count);
      }),
    ),
  );
  return chunks;
}

/** `encodeExport`'s chunks as a stream, the shape `Migration.export` returns. */
export async function* exportStream(ledger: LedgerExport): AsyncIterable<Uint8Array> {
  yield* encodeExport(ledger);
}

// --- Reading -----------------------------------------------------------------

/** The outcome of reading an export: the export, or why it is refused. */
export type ReadExport =
  | { readonly ok: true; readonly ledger: LedgerExport }
  | (MigrationFailure & { readonly reason: "malformed" });

/** Options for `readExport`. */
export interface ReadExportOptions {
  /**
   * The deployment's publication key registration. When given, the checkpoint
   * must be signed by it (`C7` §4.2); otherwise its signature is not checked.
   */
  readonly publication?: Registration;
}

class Malformed extends Error {}

/** Splits a byte stream into items, however its chunks fall. */
async function* items(stream: AsyncIterable<Uint8Array>): AsyncIterable<[number, Uint8Array]> {
  const magic = ascii(EXPORT_MAGIC);
  let buffer: Uint8Array = new Uint8Array(0);
  // Bytes before `offset` are consumed; the buffer is compacted only when a chunk arrives.
  let offset = 0;
  let headerRead = false;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Malformed("a chunk is not bytes");
    buffer = concatBytes(buffer.subarray(offset), chunk);
    offset = 0;
    for (;;) {
      if (!headerRead) {
        if (buffer.length < magic.length + 1) break;
        if (!equalBytes(buffer.subarray(0, magic.length), magic)) {
          throw new Malformed("not a Ticketto export");
        }
        const version = buffer[magic.length];
        if (version !== EXPORT_VERSION) {
          throw new Malformed(`unsupported export version ${version}`);
        }
        offset = magic.length + 1;
        headerRead = true;
        continue;
      }
      const next = splitItem(buffer.subarray(offset));
      if (next === null) break;
      const [tag, itemBody, consumed] = next;
      offset += consumed;
      yield [tag, itemBody];
    }
  }
  if (!headerRead) throw new Malformed("the stream ends before the export header");
  if (offset < buffer.length) throw new Malformed("the stream ends inside an item");
}

/**
 * One item off the front of `bytes` — its tag, a copy of its body, and how many
 * bytes it took — or `null` when `bytes` does not yet hold a whole one.
 */
function splitItem(bytes: Uint8Array): [number, Uint8Array, number] | null {
  const reader = new Reader(bytes);
  let tag: number;
  let length: number;
  try {
    tag = reader.u8();
    length = reader.compact();
  } catch (error) {
    // Too few bytes yet for the tag and a whole length; any other fault is final.
    if (error instanceof LogDecodeError && error.message === "unexpected end of input") return null;
    throw new Malformed(`item: ${String(error)}`);
  }
  if (length > reader.remaining) return null;
  const start = bytes.length - reader.remaining;
  return [tag, bytes.slice(start, start + length), start + length];
}

function sortedUnique<T>(list: readonly T[], key: (value: T) => string, what: string): void {
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [key(list[i - 1] as T), key(list[i] as T)];
    if (!(a < b)) throw new Malformed(`${what}: not in strictly ascending order at ${b}`);
  }
}

/**
 * Reads an export stream, refusing anything but a complete, well-formed export
 * whose parts agree (`reason: "malformed"`):
 *
 * - the header, then items in section order, each canonically encoded, closed by
 *   an `end` item whose counts match, with nothing after it;
 * - records forming a chain from sequence 0 (`C7` §3), a checkpoint exactly when
 *   there are records, at the last record and with its hash — signed by
 *   `options.publication` when given;
 * - every section sorted by its key without duplicates; every ticket's event in
 *   the snapshot; every credential's registration deriving an account through
 *   the profile; a cancellation holder for exactly the tickets of `Cancelled`
 *   events; every consumed pass's ticket in the snapshot; every operation naming
 *   a record that carries a command with that operation id and expiry, whose
 *   signed-input digest is the operation's.
 *
 * It does not re-run the ledger's rules over the snapshot: import verifies by
 * observable state instead (plan §5.5).
 */
export async function readExport(
  stream: AsyncIterable<Uint8Array>,
  options: ReadExportOptions = {},
): Promise<ReadExport> {
  try {
    return { ok: true, ledger: await read(stream, options) };
  } catch (error) {
    if (error instanceof Malformed || error instanceof LogDecodeError) {
      return { ok: false, reason: "malformed", detail: error.message };
    }
    throw error;
  }
}

async function read(
  stream: AsyncIterable<Uint8Array>,
  options: ReadExportOptions,
): Promise<LedgerExport> {
  const tag = EXPORT_ITEM_TAG;
  const recordBytes: Uint8Array[] = [];
  const decoded: ChainedRecord[] = [];
  let checkpoint: Checkpoint | null = null;
  const events: Event[] = [];
  const tickets: Ticket[] = [];
  const credentials: ExportedCredential[] = [];
  const cancellationHolders: ExportedCancellationHolder[] = [];
  const consumedPasses: ExportedConsumedPass[] = [];
  const operations: ExportedOperation[] = [];
  let section: number = tag.record;
  let ended = false;

  for await (const [itemTag, itemBody] of items(stream)) {
    if (ended) throw new Malformed("an item follows the end of the export");
    if (itemTag === tag.end) {
      const counts = parse(itemBody, (r) => Array.from({ length: 8 }, () => r.compact()));
      const actual = [
        recordBytes.length,
        checkpoint === null ? 0 : 1,
        events.length,
        tickets.length,
        credentials.length,
        cancellationHolders.length,
        consumedPasses.length,
        operations.length,
      ];
      if (counts.some((count, i) => count !== actual[i])) {
        throw new Malformed(`the end item counts ${counts.join(",")}, the export holds ${actual}`);
      }
      ended = true;
      continue;
    }
    if (itemTag < section || itemTag > tag.operation) {
      throw new Malformed(`item tag ${itemTag} out of order or unknown`);
    }
    section = itemTag;
    switch (itemTag) {
      case tag.record:
        recordBytes.push(itemBody);
        decoded.push(decodeRecord(itemBody));
        break;
      case tag.checkpoint:
        if (checkpoint !== null) throw new Malformed("more than one checkpoint");
        checkpoint = decodeCheckpoint(itemBody);
        break;
      case tag.event:
        events.push(parse(itemBody, readEvent));
        break;
      case tag.ticket:
        tickets.push(parse(itemBody, readTicket));
        break;
      case tag.credential: {
        const registration = parse(itemBody, (r) => r.bytes()) as Registration;
        const derived = registrationAccount(registration);
        if (!derived.ok) throw new Malformed(`credential: ${derived.error.detail ?? "invalid"}`);
        credentials.push({ ...derived.value, registration });
        break;
      }
      case tag.cancellationHolder:
        cancellationHolders.push(
          parse(itemBody, (r) => ({
            ticket: r.codec(codecs.ticketId, "ticket"),
            holder: r.codec(codecs.accountId, "holder"),
          })),
        );
        break;
      case tag.consumedPass:
        consumedPasses.push(
          parse(itemBody, (r) => ({
            ticket: r.codec(codecs.ticketId, "ticket"),
            pass: r.codec(codecs.passId, "pass"),
            retainUntil: r.u64(),
          })),
        );
        break;
      default:
        operations.push(
          parse(itemBody, (r) => ({
            operationId: r.codec(codecs.operationId, "operationId"),
            expiresAt: r.u64(),
            digest: r.fixed(HASH_LENGTH),
            sequence: r.u64(),
          })),
        );
    }
  }
  if (!ended) throw new Malformed("the stream ends before the end of the export");

  // The chain and its checkpoint.
  const chain = verifyChain(recordBytes);
  if (!chain.ok) {
    throw new Malformed(`record ${chain.sequence}: ${chain.fault}: ${chain.detail}`);
  }
  if ((checkpoint === null) !== (recordBytes.length === 0)) {
    throw new Malformed("an export has a checkpoint exactly when it has records");
  }
  if (checkpoint !== null) {
    const { head } = chain.state;
    if (checkpoint.sequence !== head.next - 1 || checkpoint.headHash !== head.hash) {
      throw new Malformed("the checkpoint is not at the last record, with its hash");
    }
    if (options.publication !== undefined && !verifyCheckpoint(checkpoint, options.publication)) {
      throw new Malformed("the checkpoint is not signed by the publication key");
    }
  }

  // The snapshot's sections and references.
  sortedUnique(events, (e) => e.id, "events");
  sortedUnique(tickets, (t) => t.id, "tickets");
  sortedUnique(cancellationHolders, (c) => c.ticket, "cancellation holders");
  sortedUnique(consumedPasses, passKey, "consumed passes");
  sortedUnique(operations, (o) => o.operationId, "operations");
  for (let i = 1; i < credentials.length; i++) {
    if (
      compare(
        credentialKey(credentials[i - 1] as ExportedCredential),
        credentialKey(credentials[i] as ExportedCredential),
      ) > 0
    ) {
      throw new Malformed("credentials: not grouped by account in ascending order");
    }
  }
  const credentialIds = new Set<string>();
  for (const { account, credential } of credentials) {
    const key = `${account}:${credential}`;
    if (credentialIds.has(key)) throw new Malformed(`credentials: ${key} appears twice`);
    credentialIds.add(key);
  }
  const eventById = new Map(events.map((e) => [e.id, e]));
  const ticketIds = new Set<string>(tickets.map((t) => t.id));
  const cancelled = new Set<string>();
  for (const ticket of tickets) {
    const event = eventById.get(ticket.event);
    if (event === undefined) throw new Malformed(`ticket ${ticket.id}: its event is not exported`);
    if (event.status === "Cancelled") cancelled.add(ticket.id);
  }
  const held = new Set<string>(cancellationHolders.map((c) => c.ticket));
  if (held.size !== cancelled.size || [...cancelled].some((id) => !held.has(id))) {
    throw new Malformed(
      "a cancellation holder is exported for exactly the tickets of cancelled events",
    );
  }
  for (const pass of consumedPasses) {
    if (!ticketIds.has(pass.ticket)) {
      throw new Malformed(`consumed pass ${pass.pass}: its ticket is not exported`);
    }
  }
  for (const operation of operations) {
    const record = decoded[operation.sequence];
    const input = record?.input;
    if (input === undefined || !("command" in input)) {
      throw new Malformed(`operation ${operation.operationId}: no command record at its sequence`);
    }
    if (
      input.command.operationId !== operation.operationId ||
      input.command.expiresAt !== operation.expiresAt ||
      !equalBytes(blake2b256(encodeSignedCommand(input)), operation.digest)
    ) {
      throw new Malformed(`operation ${operation.operationId}: disagrees with its record`);
    }
  }

  return {
    records: recordBytes,
    checkpoint,
    snapshot: { events, tickets, credentials, cancellationHolders, consumedPasses, operations },
  };
}
