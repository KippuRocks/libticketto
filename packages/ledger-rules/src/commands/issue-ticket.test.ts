// T-008-07: issueTicket (features/008-ledger-rules/plan.md §5.2, §5.7a; SPEC.md
// US-B1–US-B3, US-B5, REQ-ID-1, REQ-ID-2, REQ-TK-2–REQ-TK-5, INV-4, INV-12–INV-14).

import type {
  AccountId,
  AttendancePolicy,
  ClassId,
  Count,
  Discriminator,
  EventStatus,
  IssueTicket,
  Placement,
  Position,
  Provenance,
  Result,
  Ticket,
  TicketId,
  TicketRestrictions,
  Zone,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  createEventCommand,
  envelope,
  id32,
  profile,
  registered,
  sign,
  type TestCredential,
  zoneId,
} from "../../test/fixtures.js";
import type { EventRecord } from "../capabilities.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const seat = (n: number): Placement => ({
  kind: "Seated",
  position: n.toString(16).padStart(4, "0") as Position,
});
let discriminators = 0;
const spot = (): Placement => {
  discriminators += 1;
  return {
    kind: "Unseated",
    discriminator: discriminators.toString(16).padStart(32, "0") as Discriminator,
  };
};

const NONE: TicketRestrictions = { cannotResale: false, cannotTransfer: false };

interface Fixture {
  readonly caps: FakeCapabilities;
  readonly organiser: TestCredential;
  readonly event: EventRecord;
  readonly seated: Zone;
  readonly unseated: Zone;
  /** An `issueTicket` against the fixture's event, with its id derived. */
  issue(options?: {
    readonly zone?: ZoneId;
    readonly placement?: Placement;
    readonly provenance?: Provenance;
    readonly restrictions?: TicketRestrictions;
    readonly policy?: AttendancePolicy;
    readonly holder?: AccountId;
  }): IssueTicket;
  /** Signs and executes a command as the organiser. */
  run(command: IssueTicket, signer?: TestCredential): Promise<Result<unknown>>;
}

async function fixture(
  options: { readonly capacity?: Count | null; readonly status?: EventStatus } = {},
): Promise<Fixture> {
  const caps = createFakeCapabilities();
  const organiser = await registered(caps);
  const seated: Zone = { id: zoneId(), kind: "Seated" };
  const unseated: Zone = { id: zoneId(), kind: "Unseated" };
  const create = createEventCommand(organiser.account, {
    zones: [seated, unseated],
    capacity: options.capacity ?? null,
  });
  const created = await execute(caps, profile, await sign(organiser, create));
  if (!created.ok) throw new Error(`fixture event: ${created.error.code}`);
  const stored = await caps.registry.getEvent(create.event);
  if (stored === null) throw new Error("fixture event missing");
  if (options.status !== undefined) {
    await caps.registry.putEvent({ ...stored, status: options.status });
  }
  const event = (await caps.registry.getEvent(create.event)) as EventRecord;

  const issue: Fixture["issue"] = (o = {}) => {
    const zone = o.zone ?? unseated.id;
    const placement = o.placement ?? spot();
    return {
      ...envelope(),
      kind: "issueTicket",
      event: event.id,
      ticket: profile.ticketId(event.id, zone, placement),
      zone,
      placement,
      class: "0c1a55" as ClassId,
      provenance: o.provenance ?? "Purchased",
      policy: o.policy ?? { kind: "Single" },
      restrictions: o.restrictions ?? NONE,
      holder: o.holder ?? id32<AccountId>(),
      metadata: null,
    };
  };
  const run: Fixture["run"] = async (command, signer = organiser) =>
    execute(caps, profile, await sign(signer, command));
  return { caps, organiser, event, seated, unseated, issue, run };
}

describe("issueTicket", () => {
  it("US-B1: records the ticket with its holder, class, provenance, placement and policy", async () => {
    const f = await fixture();
    const policy: AttendancePolicy = { kind: "Multiple", max: 10, until: 5_000 };
    const command = f.issue({ zone: f.seated.id, placement: seat(1), policy });

    expect((await f.run(command)).ok).toBe(true);
    expect(await f.caps.registry.getTicket(command.ticket)).toEqual({
      id: command.ticket,
      event: f.event.id,
      holder: command.holder,
      class: command.class,
      provenance: "Purchased",
      zone: f.seated.id,
      placement: command.placement,
      policy,
      restrictions: NONE,
      attendances: 0,
      cancellationHolder: null,
    } satisfies Ticket & { cancellationHolder: null });
  });

  it("INV-4: counts the ticket against the event, and records its zone in use", async () => {
    const f = await fixture();
    await f.run(f.issue({ zone: f.seated.id, placement: seat(1) }));
    await f.run(f.issue({ zone: f.seated.id, placement: seat(2) }));

    const event = await f.caps.registry.getEvent(f.event.id);
    expect(event?.issued).toBe(2);
    expect(event?.zonesInUse).toEqual([f.seated.id]);
  });

  it("AC-A1.2: with no capacity, issuance is unbounded", async () => {
    const f = await fixture({ capacity: null });
    for (let i = 0; i < 25; i++) expect((await f.run(f.issue())).ok).toBe(true);
    expect((await f.caps.registry.getEvent(f.event.id))?.issued).toBe(25);
  });

  it("AC-A1.3: once capacity n is issued, further issuance fails with ERR-CapacityExceeded", async () => {
    const f = await fixture({ capacity: 3 });
    for (let i = 0; i < 3; i++) expect((await f.run(f.issue())).ok).toBe(true);

    const extra = f.issue();
    expect(codeOf(await f.run(extra))).toBe("ERR-CapacityExceeded");
    expect(await f.caps.registry.getTicket(extra.ticket)).toBeNull();
    expect((await f.caps.registry.getEvent(f.event.id))?.issued).toBe(3);
  });

  it("AC-B5.1: issuing an already-issued seated position fails with ERR-TicketIdExists", async () => {
    const f = await fixture();
    const first = f.issue({ zone: f.seated.id, placement: seat(7) });
    expect((await f.run(first)).ok).toBe(true);

    // Same position, different class, provenance and holder: still the same ticket (REQ-ID-1).
    const again: IssueTicket = {
      ...f.issue({ zone: f.seated.id, placement: seat(7), provenance: "Granted" }),
      class: "07" as ClassId,
    };
    expect(again.ticket).toBe(first.ticket);
    expect(codeOf(await f.run(again))).toBe("ERR-TicketIdExists");
    expect((await f.caps.registry.getTicket(first.ticket))?.holder).toBe(first.holder);
    expect((await f.caps.registry.getEvent(f.event.id))?.issued).toBe(1);
  });

  it("AC-B5.3: an unseated zone is bounded only by capacity", async () => {
    const f = await fixture({ capacity: 5 });
    for (let i = 0; i < 5; i++)
      expect((await f.run(f.issue({ zone: f.unseated.id }))).ok).toBe(true);
    expect(codeOf(await f.run(f.issue({ zone: f.unseated.id })))).toBe("ERR-CapacityExceeded");
  });

  it.each<[string, TicketRestrictions]>([
    ["cannotResale", { cannotResale: true, cannotTransfer: false }],
    ["cannotTransfer", { cannotResale: false, cannotTransfer: true }],
    ["both", { cannotResale: true, cannotTransfer: true }],
  ])(
    "AC-B3.1: a purchased ticket issued with %s fails with ERR-RestrictionNotPermitted",
    async (_, restrictions) => {
      const f = await fixture();
      const command = f.issue({ provenance: "Purchased", restrictions });
      expect(codeOf(await f.run(command))).toBe("ERR-RestrictionNotPermitted");
      expect(await f.caps.registry.getTicket(command.ticket)).toBeNull();
    },
  );

  it("INV-12: a purchased ticket is recorded with no restriction", async () => {
    const f = await fixture();
    const command = f.issue({ provenance: "Purchased" });
    await f.run(command);
    expect((await f.caps.registry.getTicket(command.ticket))?.restrictions).toEqual(NONE);
  });

  it("REQ-TK-4: a granted ticket may carry restrictions", async () => {
    const f = await fixture();
    const restrictions = { cannotResale: true, cannotTransfer: false };
    const command = f.issue({ provenance: "Granted", restrictions });
    expect((await f.run(command)).ok).toBe(true);
    expect((await f.caps.registry.getTicket(command.ticket))?.restrictions).toEqual(restrictions);
  });

  it("REQ-TK-2: cannotTransfer implies cannotResale", async () => {
    const f = await fixture();
    const command = f.issue({
      provenance: "Granted",
      restrictions: { cannotResale: false, cannotTransfer: true },
    });
    expect((await f.run(command)).ok).toBe(true);
    expect((await f.caps.registry.getTicket(command.ticket))?.restrictions).toEqual({
      cannotResale: true,
      cannotTransfer: true,
    });
  });

  it("INV-14: the provenance given is the provenance recorded", async () => {
    const f = await fixture();
    const granted = f.issue({ provenance: "Granted" });
    await f.run(granted);
    expect((await f.caps.registry.getTicket(granted.ticket))?.provenance).toBe("Granted");
  });

  it("ERR-UnknownZone: issuance against a zone the event does not define", async () => {
    const f = await fixture();
    const command = f.issue({ zone: zoneId() });
    expect(codeOf(await f.run(command))).toBe("ERR-UnknownZone");
  });

  it("ERR-ZoneKindMismatch: an unseated placement in a seated zone", async () => {
    const f = await fixture();
    expect(codeOf(await f.run(f.issue({ zone: f.seated.id, placement: spot() })))).toBe(
      "ERR-ZoneKindMismatch",
    );
  });

  it("ERR-ZoneKindMismatch: a seated placement in an unseated zone", async () => {
    const f = await fixture();
    expect(codeOf(await f.run(f.issue({ zone: f.unseated.id, placement: seat(1) })))).toBe(
      "ERR-ZoneKindMismatch",
    );
  });

  it("ERR-IdentifierMismatch / INV-13: a ticket id not derived from event, zone and placement", async () => {
    const f = await fixture();
    const command = {
      ...f.issue({ zone: f.seated.id, placement: seat(1) }),
      ticket: id32<TicketId>(),
    };
    expect(codeOf(await f.run(command))).toBe("ERR-IdentifierMismatch");
    expect(await f.caps.registry.getTicket(command.ticket)).toBeNull();
  });

  it("ERR-IdentifierMismatch: another placement's id is refused", async () => {
    const f = await fixture();
    const other = f.issue({ zone: f.seated.id, placement: seat(2) });
    const command = { ...f.issue({ zone: f.seated.id, placement: seat(1) }), ticket: other.ticket };
    expect(codeOf(await f.run(command))).toBe("ERR-IdentifierMismatch");
  });

  it("ERR-NotOwner: a signer who does not own the event", async () => {
    const f = await fixture();
    const stranger = await registered(f.caps);
    expect(codeOf(await f.run(f.issue(), stranger))).toBe("ERR-NotOwner");
  });

  it("ERR-EventSealed: issuance against a Sealed event", async () => {
    const f = await fixture({ status: "Sealed" });
    expect(codeOf(await f.run(f.issue()))).toBe("ERR-EventSealed");
  });

  it("ERR-EventCancelled: issuance against a Cancelled event", async () => {
    const f = await fixture({ status: "Cancelled" });
    expect(codeOf(await f.run(f.issue()))).toBe("ERR-EventCancelled");
  });

  it("a rejected issuance changes neither the event nor the log", async () => {
    const f = await fixture({ capacity: 0 });
    const before = await f.caps.registry.getEvent(f.event.id);
    expect(codeOf(await f.run(f.issue()))).toBe("ERR-CapacityExceeded");
    expect(await f.caps.registry.getEvent(f.event.id)).toEqual(before);
    expect(f.caps.log()).toHaveLength(1);
  });
});

describe("issueTicket — check order (plan §5.2)", () => {
  // Each row breaks two checks at once and expects the earlier one's error.
  // Fixture: capacity 1, already reached by one issued ticket at seat 1.
  type Break = (f: Fixture) => Promise<{ command: IssueTicket; signer?: TestCredential }>;
  const cases: [string, string, Break][] = [
    [
      "owner before status",
      "ERR-NotOwner",
      async (f) => {
        await f.caps.registry.putEvent({ ...f.event, status: "Sealed" });
        return { command: f.issue(), signer: await registered(f.caps) };
      },
    ],
    [
      "status before zone",
      "ERR-EventCancelled",
      async (f) => {
        const current = (await f.caps.registry.getEvent(f.event.id)) as EventRecord;
        await f.caps.registry.putEvent({ ...current, status: "Cancelled" });
        return { command: f.issue({ zone: zoneId() }) };
      },
    ],
    [
      "zone before kind",
      "ERR-UnknownZone",
      async (f) => ({ command: f.issue({ zone: zoneId(), placement: seat(3) }) }),
    ],
    [
      "kind before identifier",
      "ERR-ZoneKindMismatch",
      async (f) => ({
        command: { ...f.issue({ zone: f.seated.id, placement: spot() }), ticket: id32() },
      }),
    ],
    [
      "identifier before existence",
      "ERR-IdentifierMismatch",
      async (f) => ({
        command: {
          ...f.issue({ zone: f.seated.id, placement: seat(2) }),
          ticket: f.issue({ zone: f.seated.id, placement: seat(1) }).ticket,
        },
      }),
    ],
    [
      "existence before capacity",
      "ERR-TicketIdExists",
      async (f) => ({ command: f.issue({ zone: f.seated.id, placement: seat(1) }) }),
    ],
    [
      "capacity before restrictions",
      "ERR-CapacityExceeded",
      async (f) => ({
        command: f.issue({ restrictions: { cannotResale: true, cannotTransfer: true } }),
      }),
    ],
  ];

  it.each(cases)("%s", async (_, code, breakTwo) => {
    const f = await fixture({ capacity: 1 });
    const first = await f.run(f.issue({ zone: f.seated.id, placement: seat(1) }));
    expect(first.ok).toBe(true);
    const { command, signer } = await breakTwo(f);
    expect(codeOf(await f.run(command, signer))).toBe(code);
  });
});
