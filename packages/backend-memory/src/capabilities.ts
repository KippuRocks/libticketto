// In-memory C3 capabilities — T-005-01, features/005-backend-memory/plan.md §5.1.
//
// Maps for events, registrations, tickets, consumed pass ids, operation ids and
// the log. Every transaction takes one global async mutex and writes into its
// own copy-on-write layer over the committed state; the layer is folded into
// the committed state, in one synchronous step, only when the transaction's
// function resolves. Serialisable by construction (`INV-6`, `AC-E3.2`), and
// deliberately naive: correctness over speed.
//
// Nothing here is persisted, and nothing is forgotten: the registry MAY drop a
// consumed pass or an operation past its retention, and this one never does.

import type {
  Capabilities,
  Clock,
  CredentialRegistration,
  LogAppend,
  OperationRecord,
  Registry,
  TicketFacts,
  TicketRecord,
} from "@ticketto/ledger-rules";
import type {
  AccountId,
  Count,
  Cursor,
  Event,
  EventId,
  LogRecord,
  OperationId,
  PassId,
  Ticket,
  TicketId,
  Timestamp,
} from "@ticketto/sdk";

/** Options for {@link createMemoryCapabilities}. */
export interface MemoryCapabilitiesOptions {
  /** The capabilities' clock. Defaults to the system clock, held monotonic. */
  readonly clock?: Clock;
}

/** A clock over the system time that never returns less than it returned before. */
function createSystemClock(): Clock {
  let last: Timestamp = 0;
  return {
    now() {
      last = Math.max(last, Date.now());
      return last;
    },
  };
}

/** One table's writes within a transaction, over the committed table beneath it. */
class Layer<K, V> {
  readonly #base: Map<K, V>;
  readonly #writes = new Map<K, V>();

  constructor(base: Map<K, V>) {
    this.#base = base;
  }

  get(key: K): V | undefined {
    return this.#writes.has(key) ? this.#writes.get(key) : this.#base.get(key);
  }

  has(key: K): boolean {
    return this.#writes.has(key) || this.#base.has(key);
  }

  set(key: K, value: V): void {
    this.#writes.set(key, value);
  }

  commit(): void {
    for (const [key, value] of this.#writes) this.#base.set(key, value);
  }
}

/** The committed state. Stored values are readonly and replaced, never mutated. */
interface State {
  readonly events: Map<EventId, Event>;
  readonly registrations: Map<AccountId, readonly CredentialRegistration[]>;
  readonly tickets: Map<TicketId, TicketRecord>;
  /** Keyed by ticket and pass id; the value is the retention time. */
  readonly consumedPasses: Map<string, Timestamp>;
  readonly operations: Map<OperationId, OperationRecord>;
  /** The number of records each event has in the log. */
  readonly eventRecords: Map<EventId, Count>;
  readonly log: LogRecord[];
}

const passKey = (ticket: TicketId, pass: PassId) => `${ticket}/${pass}`;

const copyOperation = (operation: OperationRecord): OperationRecord => ({
  ...operation,
  digest: operation.digest.slice(),
});

/** A registry that reads through `state`'s layers and writes into them. */
function layeredRegistry(state: State, assertOpen: () => void) {
  const events = new Layer(state.events);
  const registrations = new Layer(state.registrations);
  const tickets = new Layer(state.tickets);
  const consumedPasses = new Layer(state.consumedPasses);
  const operations = new Layer(state.operations);
  const eventRecords = new Layer(state.eventRecords);
  const appended: LogRecord[] = [];

  const existingTicket = (id: TicketId): TicketRecord => {
    const ticket = tickets.get(id);
    if (ticket === undefined) throw new Error(`no ticket ${id}`);
    return ticket;
  };

  const registry: Registry = {
    async getEvent(id) {
      assertOpen();
      return events.get(id) ?? null;
    },
    async putEvent(event) {
      assertOpen();
      events.set(event.id, event);
    },

    async getRegistrations(account) {
      assertOpen();
      return registrations.get(account) ?? [];
    },
    async addRegistration(account, registration) {
      assertOpen();
      registrations.set(account, [...(registrations.get(account) ?? []), registration]);
    },

    async getTicket(id) {
      assertOpen();
      return tickets.get(id) ?? null;
    },
    async insertTicket(ticket: Ticket) {
      assertOpen();
      if (tickets.has(ticket.id)) return "exists";
      tickets.set(ticket.id, { ...ticket, cancellationHolder: null });
      return "inserted";
    },
    async setHolder(id, holder) {
      assertOpen();
      tickets.set(id, { ...existingTicket(id), holder });
    },
    async recordTicketFacts(id, facts: TicketFacts) {
      assertOpen();
      tickets.set(id, { ...existingTicket(id), ...facts });
    },

    async isPassConsumed(ticket, pass) {
      assertOpen();
      return consumedPasses.has(passKey(ticket, pass));
    },
    async recordConsumedPass(ticket, pass, retainUntil) {
      assertOpen();
      consumedPasses.set(passKey(ticket, pass), retainUntil);
    },

    async getOperation(id) {
      assertOpen();
      const operation = operations.get(id);
      return operation === undefined ? null : copyOperation(operation);
    },
    async recordOperation(id, operation) {
      assertOpen();
      // A copy: the store keeps its own bytes.
      operations.set(id, copyOperation(operation));
    },

    async appendLog(append: LogAppend) {
      assertOpen();
      let event: LogRecord["event"] = null;
      if (append.event !== null) {
        // An event's first record is sequence 0, as in the published log (C7).
        const sequence = eventRecords.get(append.event) ?? 0;
        eventRecords.set(append.event, sequence + 1);
        event = { id: append.event, sequence };
      }
      const record: LogRecord = {
        cursor: String(state.log.length + appended.length + 1) as Cursor,
        recordedAt: append.recordedAt,
        event,
        entry: append.entry,
        presentedAt: append.presentedAt,
      };
      appended.push(record);
      return record;
    },
  };

  const commit = () => {
    events.commit();
    registrations.commit();
    tickets.commit();
    consumedPasses.commit();
    operations.commit();
    eventRecords.commit();
    state.log.push(...appended);
  };

  return { registry, commit };
}

/**
 * Fresh, empty in-memory capabilities (`C3`).
 *
 * `transaction` runs one function at a time, in the order they were started.
 * Its writes are visible inside it at once, and outside it only once its
 * function resolves; when the function rejects, none of them is. A transaction
 * started from inside another transaction's function waits for that
 * transaction, which is waiting for it: the rules never do this, and `C3`
 * forbids a function any effect outside its own `tx`.
 *
 * `registry`, outside any transaction, reads the committed state directly —
 * a commit is one synchronous step, so no read sees part of one — and runs
 * each write as a transaction of its own.
 */
export function createMemoryCapabilities(options: MemoryCapabilitiesOptions = {}): Capabilities {
  const state: State = {
    events: new Map(),
    registrations: new Map(),
    tickets: new Map(),
    consumedPasses: new Map(),
    operations: new Map(),
    eventRecords: new Map(),
    log: [],
  };
  let tail: Promise<unknown> = Promise.resolve();

  const transaction = <T>(fn: (tx: Registry) => Promise<T>): Promise<T> => {
    const run = async () => {
      let open = true;
      const { registry: tx, commit } = layeredRegistry(state, () => {
        if (!open) throw new Error("transaction already settled");
      });
      try {
        const value = await fn(tx);
        commit();
        return value;
      } finally {
        open = false;
      }
    };
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };

  // Reads outside a transaction see the committed state; they write nothing,
  // so the throwaway layer beneath them is never committed.
  const read = layeredRegistry(state, () => {}).registry;
  const write = <K extends keyof Registry>(method: K): Registry[K] =>
    ((...args: unknown[]) =>
      transaction((tx) =>
        (tx[method] as (...a: unknown[]) => Promise<unknown>)(...args),
      )) as Registry[K];

  const registry: Registry = {
    getEvent: (id) => read.getEvent(id),
    putEvent: write("putEvent"),
    getRegistrations: (account) => read.getRegistrations(account),
    addRegistration: write("addRegistration"),
    getTicket: (id) => read.getTicket(id),
    insertTicket: write("insertTicket"),
    setHolder: write("setHolder"),
    recordTicketFacts: write("recordTicketFacts"),
    isPassConsumed: (ticket, pass) => read.isPassConsumed(ticket, pass),
    recordConsumedPass: write("recordConsumedPass"),
    getOperation: (id) => read.getOperation(id),
    recordOperation: write("recordOperation"),
    appendLog: write("appendLog"),
  };

  return {
    registry,
    clock: options.clock ?? createSystemClock(),
    transaction,
  };
}
