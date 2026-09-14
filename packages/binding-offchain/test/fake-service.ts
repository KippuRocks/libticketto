// A C4 service in miniature, for the submission suites: `POST /v0/submit` and
// `GET /v0/operations/{operationId}` with C4.md §3.1–§3.2's identity and
// idempotency, a ledger that counts the state changes it records, and faults
// injected per request. Portable: no Node API, no platform `fetch`.
//
// It stands in for `ticketto-offchain` only as far as the binding can observe
// it. The real service runs the rules; this one applies each distinct accepted
// input once, after a configurable number of pending polls, and refuses a
// different input under a recorded operation id with ERR-OperationConflict.

import { decodeSignedAccessPass, decodeSignedCommand } from "@ticketto/profile-v0";
import type { TickettoError } from "@ticketto/sdk";
import type { FetchInit, FetchLike, FetchResponseLike } from "../src/client.js";
import { fromHex } from "../src/hex.js";
import { AssertionError } from "./harness.js";

/** What happens to one request, in the order requests arrive. */
export type Fault =
  /** The connection fails before the request reaches the service. */
  | "drop-before"
  /** The service handles the request, and the response is lost. */
  | "drop-after"
  /** The request never completes: only the caller's timeout ends it. */
  | "hang"
  /** `503 unavailable`, with `Retry-After` when given. */
  | { readonly unavailable: number | null }
  /** A proxy's `502` page. */
  | "bad-gateway"
  /** `400 malformed`: a defect on one side. */
  | "malformed"
  /** The service restarts first, losing every submission whose effects it had not recorded. */
  | "restart"
  /** Handled normally. */
  | "none";

interface Held {
  readonly token: string;
  readonly operationId: string;
  readonly identity: string;
  state: "pending" | "settled" | "rejected";
  polls: number;
  cursor?: string;
  error?: TickettoError;
}

export interface FakeServiceOptions {
  /** The most records one log page carries: the service MAY return fewer than asked (C4.md §3.4). */
  readonly pageSize?: number;
  /** Whether hint responses stream their bodies, as Node's `fetch` does and React Native's does not. */
  readonly streams?: boolean;
  /** Answers `POST /v0/query`: the SDK's `Result`, as C4 carries it. */
  readonly query?: (query: Record<string, unknown>) => unknown;
  /** The test-mode clock's start; without it, `/v0/testing/clock` does not exist (C4.md Appendix A). */
  readonly clock?: number;
  /** The assurance declaration `GET /v0/assurance` answers. */
  readonly assurance?: Record<string, string>;
  /** Pending answers each submission gets before it is recorded. */
  readonly pendingPolls?: number;
  readonly faults?: readonly Fault[];
  /** The outcome the rules decide for an input, when not settled. */
  readonly rules?: (operationId: string) => TickettoError | undefined;
  /** Called when a request hangs, after it has started: typically `InstantTimers.expire`. */
  readonly onHang?: () => void;
}

export interface SeenExchange {
  readonly method: string;
  readonly path: string;
  readonly body: string | undefined;
  readonly fault: Fault;
}

/** A log record as `GET /v0/log` carries it (C4.md §3.4). */
export interface LogRecordJson {
  readonly cursor: string;
  readonly recordedAt: number;
  readonly event: { readonly id: string; readonly sequence: number } | null;
  readonly entry: { readonly kind: "command" | "pass"; readonly bytes: string };
  readonly presentedAt: number | null;
}

const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
};

function response(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = JSON_HEADERS,
): FetchResponseLike {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

export class FakeService {
  /** State changes the ledger recorded, in order: one per applied input. */
  readonly recorded: string[] = [];
  /** The log, as `GET /v0/log` carries its records. */
  readonly log: LogRecordJson[] = [];
  readonly seen: SeenExchange[] = [];
  private readonly held = new Map<string, Held>();
  private tokens = 0;
  /** The test-mode clock, when the service is in test mode. */
  now: number | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly options: FakeServiceOptions;
  private readonly pendingPolls: number;
  private faults: readonly Fault[];
  private readonly rules: (operationId: string) => TickettoError | undefined;
  private readonly onHang: () => void;

  constructor(options: FakeServiceOptions = {}) {
    this.pendingPolls = options.pendingPolls ?? 1;
    this.faults = options.faults ?? [];
    this.rules = options.rules ?? (() => undefined);
    this.onHang = options.onHang ?? (() => {});
    this.options = options;
    this.now = options.clock;
  }

  /** The cursor of the latest record, or `""` for an empty log. */
  get head(): string {
    return this.log[this.log.length - 1]?.cursor ?? "";
  }

  /** Records an input directly, as if submitted and settled: `kind/bytes/presentedAt`. */
  append(identity: string): string {
    const [kind, bytes, presentedAt] = identity.split("/") as [string, string, string];
    let event: LogRecordJson["event"] = null;
    if (kind === "command") {
      const decoded = decodeSignedCommand(fromHex(bytes));
      const id = decoded.ok ? (decoded.value.command as { event?: string }).event : undefined;
      if (id !== undefined) {
        const sequence = this.log.filter((r) => r.event?.id === id).length;
        event = { id, sequence };
      }
    }
    this.recorded.push(identity);
    const cursor = String(this.recorded.length);
    this.log.push({
      cursor,
      recordedAt: 1_760_000_000_000 + this.log.length * 1000,
      event,
      entry: { kind: kind as "command" | "pass", bytes },
      presentedAt: presentedAt === "" ? null : Number(presentedAt),
    });
    for (const listener of this.listeners) listener();
    return cursor;
  }

  get fetch(): FetchLike {
    return (url, init) => this.handle(url, init);
  }

  /** Submit requests the service received, as sent. */
  get submits(): string[] {
    return this.seen
      .filter((s) => s.method === "POST" && s.fault !== "drop-before")
      .map((s) => s.body ?? "");
  }

  private async handle(url: string, init: FetchInit): Promise<FetchResponseLike> {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const fault = this.faults[this.seen.length] ?? "none";
    this.seen.push({ method: init.method, path, body: init.body, fault });
    await Promise.resolve();
    if (fault === "drop-before") throw new TypeError("fetch failed: connection reset");
    if (fault === "hang") {
      Promise.resolve().then(this.onHang);
      return new Promise<never>(() => {});
    }
    if (fault === "bad-gateway") {
      return response(502, "<html>Bad Gateway</html>", { "content-type": "text/html" });
    }
    if (fault === "malformed") return response(400, { error: { code: "malformed" } });
    if (typeof fault === "object") {
      const headers =
        fault.unavailable === null
          ? JSON_HEADERS
          : { ...JSON_HEADERS, "retry-after": String(fault.unavailable) };
      return response(503, { error: { code: "unavailable" } }, headers);
    }
    if (fault === "restart") {
      for (const [token, held] of this.held) if (held.state === "pending") this.held.delete(token);
    }
    const answer = this.route(path, init);
    if (fault === "drop-after") throw new TypeError("fetch failed: connection reset");
    return answer;
  }

  private route(path: string, init: FetchInit): FetchResponseLike {
    if (path === "/v0/submit" && init.method === "POST") return this.submit(init.body ?? "");
    if (path === "/v0/query" && init.method === "POST") {
      return response(200, { result: this.options.query?.(JSON.parse(init.body ?? "{}")) });
    }
    if (path.startsWith("/v0/log?")) return this.readLog(path);
    if (path === "/v0/log/hints") return this.hints();
    if (path === "/v0/checkpoints/latest") {
      return response(200, { head: this.head, checkpoint: null });
    }
    if (path === "/v0/assurance") {
      return response(200, { assurance: this.options.assurance ?? {} });
    }
    if (path === "/v0/testing/clock") return this.testClock(init);
    return this.poll(path);
  }

  private submit(text: string): FetchResponseLike {
    const body = JSON.parse(text) as {
      input: { kind: "command" | "pass"; bytes: string };
      sponsorship: string | null;
      presentedAt?: number;
    };
    if (body.sponsorship === null) {
      return response(403, { error: { code: "sponsorship-missing" } });
    }
    const bytes = fromHex(body.input.bytes);
    let operationId: string;
    if (body.input.kind === "command") {
      const decoded = decodeSignedCommand(bytes);
      if (!decoded.ok) return response(422, { rejection: decoded.error });
      operationId = decoded.value.command.operationId;
    } else {
      const decoded = decodeSignedAccessPass(bytes);
      if (!decoded.ok) return response(422, { rejection: decoded.error });
      operationId = decoded.value.pass.id;
    }
    const identity = `${body.input.kind}/${body.input.bytes}/${body.presentedAt ?? ""}`;
    let held = [...this.held.values()].find((h) => h.identity === identity);
    if (held === undefined) {
      const conflict = [...this.held.values()].some((h) => h.operationId === operationId);
      held = {
        token: `s${++this.tokens}`,
        operationId,
        identity,
        state: conflict ? "rejected" : "pending",
        polls: 0,
        ...(conflict ? { error: { code: "ERR-OperationConflict" as const } } : {}),
      };
      this.held.set(held.token, held);
    }
    return response(202, { operationId, submission: held.token });
  }

  private readLog(path: string): FetchResponseLike {
    const match = /^\/v0\/log\?from=([^&]*)&limit=(\d+)$/.exec(path);
    if (match === null) return response(400, { error: { code: "malformed" } });
    const from = match[1] as string;
    const limit = Math.min(Number(match[2]), this.options.pageSize ?? 1000);
    const start = from === "" ? 0 : this.log.findIndex((r) => r.cursor === from) + 1;
    if (start === 0 && from !== "") return response(404, { error: { code: "cursor-unknown" } });
    const records = this.log.slice(start, start + limit);
    return response(200, { records, next: records[records.length - 1]?.cursor ?? from });
  }

  /** A live hint stream: the head on connecting, then each new head (C4.md §3.5). */
  private hints(): FetchResponseLike {
    const headers = { "content-type": "text/event-stream" };
    const base = response(200, "", headers);
    if (this.options.streams === false) return { ...base, body: null };
    const encode = (cursor: string) =>
      Uint8Array.from(`event: hint\ndata: {"cursor":"${cursor}"}\n\n`, (c) => c.charCodeAt(0));
    let sent: string | undefined;
    let closed = false;
    let wake: (() => void) | undefined;
    const listener = () => wake?.();
    this.listeners.add(listener);
    const reader = {
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
        while (!closed && sent === this.head) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (closed) return { done: true };
        sent = this.head;
        return { done: false, value: encode(sent) };
      },
      cancel: async () => {
        closed = true;
        this.listeners.delete(listener);
        wake?.();
      },
    };
    return { ...base, body: { getReader: () => reader } };
  }

  /** C4.md Appendix A: the test-mode clock. */
  private testClock(init: FetchInit): FetchResponseLike {
    if (this.now === undefined) return response(404, { error: { code: "not-found" } });
    if (init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as { set?: number; advance?: number };
      const keys = Object.keys(body);
      if (keys.length !== 1) return response(400, { error: { code: "malformed" } });
      if (body.set !== undefined) {
        if (body.set < this.now) return response(400, { error: { code: "malformed" } });
        this.now = body.set;
      } else if (body.advance !== undefined && body.advance >= 0) {
        this.now += body.advance;
      } else {
        return response(400, { error: { code: "malformed" } });
      }
    }
    return response(200, { now: this.now });
  }

  /** Applies `faults` to the next requests, in order, after those already seen. */
  inject(...faults: Fault[]): void {
    this.faults = [...this.seen.map((): Fault => "none"), ...faults];
  }

  /** Hint streams still open. */
  get openStreams(): number {
    return this.listeners.size;
  }

  private poll(path: string): FetchResponseLike {
    const match = /^\/v0\/operations\/([0-9a-f]+)\?submission=([^&]+)&wait=(\d+)$/.exec(path);
    if (match === null) throw new AssertionError(`the binding polled ${path}`);
    const held = this.held.get(match[2] as string);
    if (held === undefined || held.operationId !== match[1]) {
      return response(404, { error: { code: "operation-unknown" } });
    }
    if (held.state === "pending") {
      held.polls += 1;
      if (held.polls > this.pendingPolls) {
        const error = this.rules(held.operationId);
        if (error === undefined) {
          held.cursor = this.append(held.identity);
          held.state = "settled";
        } else {
          held.state = "rejected";
          held.error = error;
        }
      }
    }
    switch (held.state) {
      case "settled":
        return response(200, {
          state: "settled",
          receipt: { operationId: held.operationId, cursor: held.cursor },
        });
      case "rejected":
        return response(200, { state: "rejected", error: held.error });
      default:
        return response(200, { state: "pending" });
    }
  }
}

/** A request timeout the suites use: long enough that only `InstantTimers.expire()` ends a request. */
export const TIMEOUT_MARGIN = 3_600_000;

/**
 * Timers that never wait. A delay shorter than `TIMEOUT_MARGIN` — a backoff, a
 * `Retry-After` — fires on the next microtask; a request timeout fires only when
 * `expire()` is called, as the service does for a hung request. Records every
 * delay asked for.
 */
export class InstantTimers {
  readonly delays: number[] = [];
  private next = 1;
  private readonly timeouts = new Map<number, () => void>();

  setTimeout(callback: () => void, milliseconds: number): unknown {
    const handle = this.next++;
    this.delays.push(milliseconds);
    if (milliseconds >= TIMEOUT_MARGIN) {
      this.timeouts.set(handle, callback);
    } else {
      Promise.resolve().then(callback);
    }
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  /** The delays that were backoffs, not request timeouts. */
  get backoffs(): number[] {
    return this.delays.filter((delay) => delay < TIMEOUT_MARGIN);
  }

  /** Fires every request timeout still set. */
  expire(): void {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    for (const callback of callbacks) callback();
  }
}
