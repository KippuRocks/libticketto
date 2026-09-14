// Seeded generators for property tests. Deterministic, so a failure under
// Hermes reproduces under Node with the same seed.

import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Command,
  Discriminator,
  EventId,
  EventStatus,
  OperationId,
  Placement,
  Position,
  ProofId,
  Registration,
  Restriction,
  TicketId,
  Zone,
  ZoneId,
} from "@ticketto/sdk";
import { toHex } from "../src/bytes.js";

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** A uniform 32-bit unsigned integer (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** An integer in `[0, bound)`. */
  below(bound: number): number {
    return Math.floor((this.next() / 0x1_0000_0000) * bound);
  }

  bool(): boolean {
    return (this.next() & 1) === 1;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.below(items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.next() & 255;
    return out;
  }

  hex<T extends string>(length: number): T {
    return toHex(this.bytes(length)) as T;
  }

  /** A non-negative safe integer, biased towards the boundaries of SCALE's compact modes. */
  count(): number {
    const edges = [0, 1, 63, 64, 16_383, 16_384, 1_073_741_823, 1_073_741_824];
    switch (this.below(4)) {
      case 0:
        return this.pick([...edges, Number.MAX_SAFE_INTEGER]);
      case 1:
        return this.below(1 << 14);
      case 2:
        return this.next();
      default:
        return this.next() * 0x20_0000 + (this.next() & 0x1f_ffff);
    }
  }

  timestamp(): number {
    return this.bool() ? 1_700_000_000_000 + this.below(1_000_000_000) : this.count();
  }

  maybe<T>(make: () => T): T | null {
    return this.bool() ? make() : null;
  }

  text(): string {
    const alphabet = ["a", "Z", "0", "/", ":", ".", "-", "é", "漢", "🎫"];
    let out = "";
    for (let i = this.below(40); i > 0; i--) out += this.pick(alphabet);
    return out;
  }

  // Identity components.
  eventId = (): EventId => this.hex<EventId>(32);
  ticketId = (): TicketId => this.hex<TicketId>(32);
  zoneId = (): ZoneId => this.hex<ZoneId>(32);
  accountId = (): AccountId => this.hex<AccountId>(32);
  operationId = (): OperationId => this.hex<OperationId>(16);
  discriminator = (): Discriminator => this.hex<Discriminator>(16);
  position = (): Position => this.hex<Position>(this.below(12));
  classId = (): ClassId => this.hex<ClassId>(this.below(40));
  proofId = (): ProofId => this.hex<ProofId>(this.below(40));

  zone = (): Zone => ({ id: this.zoneId(), kind: this.pick(["Seated", "Unseated"] as const) });

  placement = (): Placement =>
    this.bool()
      ? { kind: "Seated", position: this.position() }
      : { kind: "Unseated", discriminator: this.discriminator() };

  policy = (): AttendancePolicy => {
    switch (this.below(3)) {
      case 0:
        return { kind: "Single" };
      case 1:
        return {
          kind: "Multiple",
          max: this.count(),
          until: this.maybe(() => this.timestamp()),
        };
      default:
        return { kind: "Unlimited", until: this.maybe(() => this.timestamp()) };
    }
  };

  command = (kind?: Command["kind"]): Command => {
    const envelope = { operationId: this.operationId(), expiresAt: this.timestamp() };
    const kinds: Command["kind"][] = [
      "createEvent",
      "setEventStatus",
      "setEventCapacity",
      "addZone",
      "removeZone",
      "issueTicket",
      "transferTicket",
      "removeRestriction",
      "registerCredential",
    ];
    switch (kind ?? this.pick(kinds)) {
      case "createEvent":
        return {
          kind: "createEvent",
          ...envelope,
          event: this.eventId(),
          salt: this.bytes(this.below(48)),
          zones: Array.from({ length: this.below(5) }, this.zone),
          capacity: this.maybe(() => this.count()),
          metadata: this.maybe(() => this.text()),
        };
      case "setEventStatus":
        return {
          kind: "setEventStatus",
          ...envelope,
          event: this.eventId(),
          status: this.pick<EventStatus>(["Active", "Sealed", "Cancelled", "Finished"]),
        };
      case "setEventCapacity":
        return {
          kind: "setEventCapacity",
          ...envelope,
          event: this.eventId(),
          capacity: this.maybe(() => this.count()),
          proof: this.maybe(this.proofId),
        };
      case "addZone":
        return { kind: "addZone", ...envelope, event: this.eventId(), zone: this.zone() };
      case "removeZone":
        return { kind: "removeZone", ...envelope, event: this.eventId(), zone: this.zoneId() };
      case "issueTicket":
        return {
          kind: "issueTicket",
          ...envelope,
          event: this.eventId(),
          ticket: this.ticketId(),
          zone: this.zoneId(),
          placement: this.placement(),
          class: this.classId(),
          provenance: this.pick(["Purchased", "Granted"] as const),
          policy: this.policy(),
          restrictions: { cannotResale: this.bool(), cannotTransfer: this.bool() },
          holder: this.accountId(),
          metadata: this.maybe(() => this.text()),
        };
      case "transferTicket":
        return {
          kind: "transferTicket",
          ...envelope,
          event: this.eventId(),
          ticket: this.ticketId(),
          receiver: this.accountId(),
        };
      case "removeRestriction":
        return {
          kind: "removeRestriction",
          ...envelope,
          event: this.eventId(),
          ticket: this.ticketId(),
          restriction: this.pick<Restriction>(["cannotResale", "cannotTransfer"]),
        };
      default:
        return {
          kind: "registerCredential",
          ...envelope,
          account: this.accountId(),
          registration: this.bytes(this.below(300)) as Registration,
        };
    }
  };
}
