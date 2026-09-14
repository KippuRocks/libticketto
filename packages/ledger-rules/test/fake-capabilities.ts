// Fake in-memory capabilities for this package's unit tests — T-008-01,
// features/008-ledger-rules/plan.md §7.
//
// Not the reference backend's capabilities (F-005), and never shipped: the
// rules' tests run against these, the conformance suite against backend-memory.
// Transactions hold one mutex and work on a copy of the state, committed only
// when their function resolves — serialisable by construction, and naive on
// purpose.

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
import type {
  Capabilities,
  Clock,
  CredentialRegistration,
  LogAppend,
  OperationRecord,
  Registry,
  TicketFacts,
  TicketRecord,
} from "../src/index.js";

/** A clock tests move by hand. It never moves backwards. */
export interface FakeClock extends Clock {
  /** Moves the clock to `at`, which must not be earlier than now. */
  set(at: Timestamp): void;
  /** Moves the clock forward by `by` milliseconds. */
  advance(by: number): void;
}

export function createFakeClock(start: Timestamp = 0): FakeClock {
  let current = start;
  return {
    now: () => current,
    set(at) {
      if (at < current) throw new RangeError(`the clock is monotonic: ${at} < ${current}`);
      current = at;
    },
    advance(by) {
      if (by < 0) throw new RangeError("the clock is monotonic: cannot advance by a negative");
      current += by;
    },
  };
}

/** Fake capabilities, with a view of committed state for assertions. */
export interface FakeCapabilities extends Capabilities {
  readonly clock: FakeClock;
  /** The committed log, in order. */
  log(): readonly LogRecord[];
}

interface State {
  readonly events: Map<EventId, Event>;
  readonly registrations: Map<AccountId, readonly CredentialRegistration[]>;
  readonly tickets: Map<TicketId, TicketRecord>;
  /** Keyed by ticket and pass id; the value is the retention time. */
  readonly consumedPasses: Map<string, Timestamp>;
  readonly operations: Map<OperationId, OperationRecord>;
  readonly eventSequences: Map<EventId, Count>;
  readonly log: LogRecord[];
}

function emptyState(): State {
  return {
    events: new Map(),
    registrations: new Map(),
    tickets: new Map(),
    consumedPasses: new Map(),
    operations: new Map(),
    eventSequences: new Map(),
    log: [],
  };
}

// Stored values are readonly and replaced, never mutated, so copying the
// containers is a full snapshot.
function copyState(state: State): State {
  return {
    events: new Map(state.events),
    registrations: new Map(state.registrations),
    tickets: new Map(state.tickets),
    consumedPasses: new Map(state.consumedPasses),
    operations: new Map(state.operations),
    eventSequences: new Map(state.eventSequences),
    log: [...state.log],
  };
}

const passKey = (ticket: TicketId, pass: PassId) => `${ticket}/${pass}`;

function registryOver(state: State, assertOpen: () => void): Registry {
  const existingTicket = (id: TicketId): TicketRecord => {
    const ticket = state.tickets.get(id);
    if (ticket === undefined) throw new Error(`no ticket ${id}`);
    return ticket;
  };

  return {
    async getEvent(id) {
      assertOpen();
      return state.events.get(id) ?? null;
    },
    async putEvent(event) {
      assertOpen();
      state.events.set(event.id, event);
    },

    async getRegistrations(account) {
      assertOpen();
      return state.registrations.get(account) ?? [];
    },
    async addRegistration(account, registration) {
      assertOpen();
      state.registrations.set(account, [...(state.registrations.get(account) ?? []), registration]);
    },

    async getTicket(id) {
      assertOpen();
      return state.tickets.get(id) ?? null;
    },
    async insertTicket(ticket: Ticket) {
      assertOpen();
      if (state.tickets.has(ticket.id)) return "exists";
      state.tickets.set(ticket.id, { ...ticket, cancellationHolder: null });
      return "inserted";
    },
    async setHolder(id, holder) {
      assertOpen();
      state.tickets.set(id, { ...existingTicket(id), holder });
    },
    async recordTicketFacts(id, facts: TicketFacts) {
      assertOpen();
      state.tickets.set(id, { ...existingTicket(id), ...facts });
    },

    async isPassConsumed(ticket, pass) {
      assertOpen();
      return state.consumedPasses.has(passKey(ticket, pass));
    },
    async recordConsumedPass(ticket, pass, retainUntil) {
      assertOpen();
      state.consumedPasses.set(passKey(ticket, pass), retainUntil);
    },

    async getOperation(id) {
      assertOpen();
      return state.operations.get(id) ?? null;
    },
    async recordOperation(id, operation) {
      assertOpen();
      // A copy, as a real store keeps its own bytes.
      state.operations.set(id, { ...operation, digest: operation.digest.slice() });
    },

    async appendLog(append: LogAppend) {
      assertOpen();
      let event: LogRecord["event"] = null;
      if (append.event !== null) {
        const sequence = (state.eventSequences.get(append.event) ?? 0) + 1;
        state.eventSequences.set(append.event, sequence);
        event = { id: append.event, sequence };
      }
      const record: LogRecord = {
        cursor: String(state.log.length + 1) as Cursor,
        recordedAt: append.recordedAt,
        event,
        entry: append.entry,
        presentedAt: append.presentedAt,
      };
      state.log.push(record);
      return record;
    },
  };
}

/** Fresh, empty fake capabilities. */
export function createFakeCapabilities(clock: FakeClock = createFakeClock()): FakeCapabilities {
  let committed = emptyState();
  let queue: Promise<unknown> = Promise.resolve();

  const transaction = <T>(fn: (tx: Registry) => Promise<T>): Promise<T> => {
    const run = async () => {
      const working = copyState(committed);
      let open = true;
      const tx = registryOver(working, () => {
        if (!open) throw new Error("transaction already settled");
      });
      try {
        const value = await fn(tx);
        committed = working;
        return value;
      } finally {
        open = false;
      }
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };

  // Outside a transaction, each call is a transaction of its own.
  const outside = <K extends keyof Registry>(method: K): Registry[K] => {
    const call = (...args: unknown[]) =>
      transaction((tx) => (tx[method] as (...a: unknown[]) => Promise<unknown>)(...args));
    return call as Registry[K];
  };
  const registry: Registry = {
    getEvent: outside("getEvent"),
    putEvent: outside("putEvent"),
    getRegistrations: outside("getRegistrations"),
    addRegistration: outside("addRegistration"),
    getTicket: outside("getTicket"),
    insertTicket: outside("insertTicket"),
    setHolder: outside("setHolder"),
    recordTicketFacts: outside("recordTicketFacts"),
    isPassConsumed: outside("isPassConsumed"),
    recordConsumedPass: outside("recordConsumedPass"),
    getOperation: outside("getOperation"),
    recordOperation: outside("recordOperation"),
    appendLog: outside("appendLog"),
  };

  return {
    registry,
    clock,
    transaction,
    log: () => committed.log,
  };
}
