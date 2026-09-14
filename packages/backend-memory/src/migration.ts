// Export and import — T-005-06, features/005-backend-memory/plan.md §5.6,
// REQ-MG-3.
//
// The backend's `migration` port member (F-002 §5.8a), over `@ticketto/log`'s
// export format (C7, FORMAT.md §5). Export writes the committed log's records
// verbatim, a checkpoint at the last record signed by the deployment's
// publication key, and a snapshot of state at it. Import accepts only an empty
// backend: it reads the export — refusing a malformed one — then appends its
// records at their sequences, with their hashes, and loads the snapshot. It
// never re-executes history.
//
// Nothing the format leaves out is invented: a backend's own bookkeeping is
// recomputed on import — an event's zones in use from its tickets, a
// credential's account and id from its registration, a cursor and a receipt
// from a record's sequence.

import type {
  Clock,
  CredentialRegistration,
  EventRecord,
  OperationRecord,
  TicketRecord,
} from "@ticketto/ledger-rules";
import {
  decodeRecord,
  type ExportedCancellationHolder,
  type ExportedCredential,
  type ExportedOperation,
  exportStream,
  hashRecordBytes,
  type LedgerExport,
  readExport,
  signCheckpoint,
  statementFor,
} from "@ticketto/log";
import type {
  AccountId,
  Event,
  EventId,
  Migration,
  MigrationResult,
  OperationId,
  Signer,
  Ticket,
  TicketId,
  ZoneId,
} from "@ticketto/sdk";
import {
  cursorAt,
  type MemoryStore,
  type StoreContents,
  type StoredRecord,
} from "./capabilities.js";

/** What export and import need besides the store. */
export interface MigrationOptions {
  readonly clock: Clock;
  /**
   * The deployment's publication key, which signs the export's checkpoint
   * (`C7` §4). An export of a non-empty log without one throws.
   */
  readonly publication?: Signer;
}

/** A ledger export of `contents`, as of `now`: consumed passes and operations still retained. */
async function ledgerOf(
  contents: StoreContents,
  now: number,
  publication: Signer | undefined,
): Promise<LedgerExport> {
  const events = new Map(contents.events.map((event) => [event.id, event]));
  const cancellationHolders: ExportedCancellationHolder[] = [];
  const tickets: Ticket[] = contents.tickets.map((record) => {
    const { cancellationHolder, ...ticket } = record;
    if (events.get(ticket.event)?.status === "Cancelled") {
      // The holder the cancellation fixed: snapshotted lazily, on the first holder change (F-008 §5.5).
      cancellationHolders.push({ ticket: ticket.id, holder: cancellationHolder ?? ticket.holder });
    }
    return ticket;
  });
  const credentials: ExportedCredential[] = [];
  for (const [account, registrations] of contents.registrations) {
    for (const { credential, registration } of registrations) {
      credentials.push({ account, credential, registration });
    }
  }
  const operations: ExportedOperation[] = [];
  for (const [operationId, { expiresAt, digest, receipt }] of contents.operations) {
    if (expiresAt < now) continue;
    operations.push({ operationId, expiresAt, digest, sequence: Number(receipt.cursor) });
  }
  const last = contents.records.at(-1);
  let checkpoint: LedgerExport["checkpoint"] = null;
  if (last !== undefined) {
    if (publication === undefined) {
      throw new Error("exporting a non-empty log needs the deployment's publication key");
    }
    checkpoint = await signCheckpoint(statementFor(last.linked.head, now), publication);
  }
  return {
    records: contents.records.map(({ linked }) => linked.bytes),
    checkpoint,
    snapshot: {
      events: contents.events.map(({ zonesInUse: _, ...event }): Event => event),
      tickets,
      credentials,
      cancellationHolders,
      consumedPasses: contents.consumedPasses.filter(({ retainUntil }) => retainUntil >= now),
      operations,
    },
  };
}

/** The store contents an export describes, the backend's bookkeeping recomputed. */
function contentsOf(ledger: LedgerExport): StoreContents {
  const { snapshot } = ledger;
  const records: StoredRecord[] = ledger.records.map((bytes) => {
    const chained = decodeRecord(bytes);
    const hash = hashRecordBytes(bytes);
    return {
      record: {
        cursor: cursorAt(chained.sequence),
        recordedAt: chained.recordedAt,
        event: chained.event,
        entry: chained.input,
        presentedAt: chained.presentedAt,
      },
      linked: { record: chained, bytes, hash, head: { next: chained.sequence + 1, hash } },
    };
  });

  // An event's zones in use are the zones its tickets were issued in (F-008 §5.7a).
  const zonesInUse = new Map<EventId, Set<ZoneId>>();
  for (const ticket of snapshot.tickets) {
    const zones = zonesInUse.get(ticket.event) ?? new Set<ZoneId>();
    zones.add(ticket.zone);
    zonesInUse.set(ticket.event, zones);
  }
  const events: EventRecord[] = snapshot.events.map((event) => ({
    ...event,
    zonesInUse: [...(zonesInUse.get(event.id) ?? [])],
  }));

  const holders = new Map<TicketId, AccountId>(
    snapshot.cancellationHolders.map(({ ticket, holder }) => [ticket, holder]),
  );
  const tickets: TicketRecord[] = snapshot.tickets.map((ticket) => ({
    ...ticket,
    cancellationHolder: holders.get(ticket.id) ?? null,
  }));

  const registrations = new Map<AccountId, CredentialRegistration[]>();
  for (const { account, credential, registration } of snapshot.credentials) {
    registrations.set(account, [
      ...(registrations.get(account) ?? []),
      { credential, registration },
    ]);
  }

  const operations = new Map<OperationId, OperationRecord>(
    snapshot.operations.map(({ operationId, expiresAt, digest, sequence }) => [
      operationId,
      { expiresAt, digest, receipt: { operationId, cursor: cursorAt(sequence) } },
    ]),
  );

  return {
    records,
    events,
    tickets,
    registrations,
    consumedPasses: snapshot.consumedPasses,
    operations,
  };
}

const notEmpty: MigrationResult = {
  ok: false,
  reason: "notEmpty",
  detail: "import accepts only an empty backend",
};

/** The `migration` member over `store`. */
export function memoryMigration(store: MemoryStore, options: MigrationOptions): Migration {
  return {
    async *export() {
      const contents = store.contents();
      yield* exportStream(await ledgerOf(contents, options.clock.now(), options.publication));
    },

    async import(stream): Promise<MigrationResult> {
      if (!store.isEmpty()) return notEmpty;
      const read = await readExport(stream);
      if (!read.ok) return read;
      const contents = contentsOf(read.ledger);
      return store.exclusive(() => {
        if (!store.isEmpty()) return notEmpty;
        store.load(contents);
        return { ok: true };
      });
    },
  };
}
