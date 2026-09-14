// A reference `migration` store for the log's own tests (T-006-04): the least a
// backend must do to export and import through `@ticketto/log`, and nothing
// else. It answers the port's log reads and point queries from what it holds,
// runs no ledger rules, and accepts no submissions. Real backends implement the
// same `migration` member over their own stores (F-005, F-010); this one never
// ships.

import type {
  AccountId,
  AssuranceDeclaration,
  Backend,
  Cursor,
  Event,
  LogRecord,
  MigrationResult,
  Query,
  Registration,
  Result,
  Signer,
  Ticket,
} from "@ticketto/sdk";
import { signCheckpoint } from "../src/checkpoint.js";
import {
  type ExportedCancellationHolder,
  type ExportedConsumedPass,
  type ExportedCredential,
  type ExportedOperation,
  exportStream,
  type LedgerExport,
  type LedgerSnapshot,
  readExport,
  statementFor,
} from "../src/index.js";
import { decodeRecord, hashRecordBytes } from "../src/record.js";

/** Everything the store holds, open to tests that tamper with it. */
export interface StoreState {
  records: Uint8Array[];
  events: Map<string, Event>;
  tickets: Map<string, Ticket>;
  credentials: ExportedCredential[];
  cancellationHolders: Map<string, ExportedCancellationHolder>;
  consumedPasses: ExportedConsumedPass[];
  operations: ExportedOperation[];
}

export interface ReferenceStore extends Backend {
  readonly state: StoreState;
}

function emptyState(): StoreState {
  return {
    records: [],
    events: new Map(),
    tickets: new Map(),
    credentials: [],
    cancellationHolders: new Map(),
    consumedPasses: [],
    operations: [],
  };
}

function load(state: StoreState, ledger: LedgerExport): void {
  const { records, snapshot } = ledger;
  state.records = [...records];
  state.events = new Map(snapshot.events.map((e) => [e.id, e]));
  state.tickets = new Map(snapshot.tickets.map((t) => [t.id, t]));
  state.credentials = [...snapshot.credentials];
  state.cancellationHolders = new Map(snapshot.cancellationHolders.map((c) => [c.ticket, c]));
  state.consumedPasses = [...snapshot.consumedPasses];
  state.operations = [...snapshot.operations];
}

function snapshotOf(state: StoreState): LedgerSnapshot {
  return {
    events: [...state.events.values()],
    tickets: [...state.tickets.values()],
    credentials: state.credentials,
    cancellationHolders: [...state.cancellationHolders.values()],
    consumedPasses: state.consumedPasses,
    operations: state.operations,
  };
}

const notFound = <T>(detail: string): Result<T> => ({
  ok: false,
  error: { code: "ERR-TicketNotFound", detail },
});

/**
 * A store holding `records` and `snapshot` (by default, nothing), whose export
 * is checkpointed by `publication`.
 */
export function referenceStore(
  publication: Signer,
  seed?: { records: readonly Uint8Array[]; snapshot: LedgerSnapshot },
): ReferenceStore {
  const state = emptyState();
  if (seed !== undefined) load(state, { ...seed, checkpoint: null });

  async function query(q: Query): Promise<Result<unknown>> {
    switch (q.kind) {
      case "getEvent": {
        const event = state.events.get(q.event);
        return event === undefined
          ? { ok: false, error: { code: "ERR-EventNotFound" } }
          : { ok: true, value: event };
      }
      case "getTicket": {
        const ticket = state.tickets.get(q.ticket);
        return ticket === undefined ? notFound(q.ticket) : { ok: true, value: ticket };
      }
      case "getCredential": {
        const found = state.credentials.find(
          (c) => c.account === q.account && c.credential === q.credential,
        );
        return { ok: true, value: (found?.registration ?? null) as Registration | null };
      }
      case "getCancellationHolder": {
        const ticket = state.tickets.get(q.ticket);
        if (ticket === undefined) return notFound(q.ticket);
        const cancelled = state.events.get(ticket.event)?.status === "Cancelled";
        const holder = state.cancellationHolders.get(q.ticket)?.holder ?? null;
        return { ok: true, value: (cancelled ? holder : null) as AccountId | null };
      }
      default:
        return { ok: false, error: { code: "ERR-LedgerUnavailable", detail: q.kind } };
    }
  }

  const store: ReferenceStore = {
    state,
    submit() {
      throw new Error("the reference migration store accepts no submissions");
    },
    query: query as Backend["query"],
    log: {
      async read(from, limit) {
        const start = from === "" ? 0 : Number(from) + 1;
        const records: LogRecord[] = state.records.slice(start, start + limit).map((bytes) => {
          const record = decodeRecord(bytes);
          return {
            cursor: String(record.sequence) as Cursor,
            recordedAt: record.recordedAt,
            event: record.event,
            entry: record.input,
            presentedAt: record.presentedAt,
          };
        });
        return { ok: true, value: { records, next: records.at(-1)?.cursor ?? from } };
      },
      async *hints() {},
    },
    assurance: {} as AssuranceDeclaration,
    migration: {
      async *export() {
        const last = state.records.at(-1);
        const checkpoint =
          last === undefined
            ? null
            : await signCheckpoint(
                statementFor({ next: state.records.length, hash: hashRecordBytes(last) }, 0),
                publication,
              );
        yield* exportStream({ records: state.records, checkpoint, snapshot: snapshotOf(state) });
      },
      async import(stream): Promise<MigrationResult> {
        const empty =
          state.records.length === 0 &&
          state.events.size === 0 &&
          state.tickets.size === 0 &&
          state.credentials.length === 0;
        if (!empty) return { ok: false, reason: "notEmpty" };
        const read = await readExport(stream);
        if (!read.ok) return read;
        load(state, read.ledger);
        return { ok: true };
      },
    },
  };
  return store;
}
