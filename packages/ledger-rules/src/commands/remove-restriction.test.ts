// T-008-12: removeRestriction (features/008-ledger-rules/plan.md §5.2, §5.7a;
// SPEC.md REQ-TK-6, INV-10, AC-B3.4).

import { COMMAND_INDEX } from "@ticketto/profile-v0";
import type {
  AccountId,
  ClassId,
  CommandKind,
  Discriminator,
  EventId,
  EventStatus,
  Provenance,
  RemoveRestriction,
  Restriction,
  Result,
  TicketId,
  TicketRestrictions,
  ZoneId,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  envelope,
  id32,
  profile,
  registered,
  sign,
  type TestCredential,
} from "../../test/fixtures.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const BOTH: TicketRestrictions = { cannotResale: true, cannotTransfer: true };
const RESALE_ONLY: TicketRestrictions = { cannotResale: true, cannotTransfer: false };
const NONE: TicketRestrictions = { cannotResale: false, cannotTransfer: false };

interface Fixture {
  readonly caps: FakeCapabilities;
  readonly organiser: TestCredential;
  readonly holder: TestCredential;
  readonly event: EventId;
  readonly ticket: TicketId;
  remove(
    restriction: Restriction,
    signer?: TestCredential,
    ticket?: TicketId,
  ): Promise<Result<unknown>>;
  restrictions(): Promise<TicketRestrictions | undefined>;
}

async function fixture(
  options: {
    readonly restrictions?: TicketRestrictions;
    readonly provenance?: Provenance;
    readonly status?: EventStatus;
  } = {},
): Promise<Fixture> {
  const caps = createFakeCapabilities();
  const organiser = await registered(caps);
  const holder = await registered(caps);
  const event = id32<EventId>();
  const zone = id32<ZoneId>();
  await caps.registry.putEvent({
    id: event,
    owner: organiser.account,
    status: options.status ?? "Active",
    maxCapacity: null,
    issued: 1,
    zones: [{ id: zone, kind: "Unseated" }],
    zonesInUse: [zone],
  });
  const ticket = id32<TicketId>();
  await caps.registry.insertTicket({
    id: ticket,
    event,
    holder: holder.account,
    class: "01" as ClassId,
    provenance: options.provenance ?? "Granted",
    zone,
    placement: { kind: "Unseated", discriminator: "0".repeat(32) as Discriminator },
    policy: { kind: "Single" },
    restrictions: options.restrictions ?? BOTH,
    attendances: 0,
  });
  return {
    caps,
    organiser,
    holder,
    event,
    ticket,
    remove: async (restriction, signer = organiser, t = ticket) => {
      const command: RemoveRestriction = {
        ...envelope(),
        kind: "removeRestriction",
        event,
        ticket: t,
        restriction,
      };
      return execute(caps, profile, await sign(signer, command));
    },
    restrictions: async () => (await caps.registry.getTicket(ticket))?.restrictions,
  };
}

describe("removeRestriction (REQ-TK-6)", () => {
  it("AC-B3.4: removing a restriction succeeds", async () => {
    const f = await fixture({ restrictions: RESALE_ONLY });
    expect((await f.remove("cannotResale")).ok).toBe(true);
    expect(await f.restrictions()).toEqual(NONE);
  });

  it("AC-B3.4: no command adds a restriction after issuance — removeRestriction only ever clears (INV-10)", async () => {
    // The only V0 commands that touch a ticket's restrictions: issuance sets them, and this one clears.
    const kinds = Object.keys(COMMAND_INDEX) as CommandKind[];
    expect(kinds.filter((k) => /restrict/i.test(k))).toEqual(["removeRestriction"]);

    for (const start of [NONE, RESALE_ONLY, BOTH]) {
      for (const restriction of ["cannotResale", "cannotTransfer"] as const) {
        const f = await fixture({ restrictions: start });
        expect((await f.remove(restriction)).ok).toBe(true);
        const after = (await f.restrictions()) as TicketRestrictions;
        expect(
          after.cannotResale && !start.cannotResale,
          `${restriction} from ${JSON.stringify(start)}`,
        ).toBe(false);
        expect(after.cannotTransfer && !start.cannotTransfer).toBe(false);
      }
    }
  });

  it("INV-10: clearing cannotTransfer clears only that flag; cannotResale alone stays", async () => {
    const f = await fixture({ restrictions: BOTH });
    expect((await f.remove("cannotTransfer")).ok).toBe(true);
    expect(await f.restrictions()).toEqual(RESALE_ONLY);
  });

  it("REQ-TK-2: clearing cannotResale on a ticket that is also cannotTransfer clears both", async () => {
    const f = await fixture({ restrictions: BOTH });
    expect((await f.remove("cannotResale")).ok).toBe(true);
    expect(await f.restrictions()).toEqual(NONE);
  });

  it("clearing a flag already clear is accepted, changes nothing, and is logged", async () => {
    for (const [start, restriction] of [
      [NONE, "cannotResale"],
      [NONE, "cannotTransfer"],
      [RESALE_ONLY, "cannotTransfer"],
    ] as const) {
      const f = await fixture({ restrictions: start });
      const before = await f.caps.registry.getTicket(f.ticket);
      expect((await f.remove(restriction)).ok).toBe(true);
      expect(await f.caps.registry.getTicket(f.ticket)).toEqual(before);
      expect(f.caps.log()).toHaveLength(1);
    }
  });

  it("INV-12: on a purchased ticket, which carries no restriction, removal changes nothing", async () => {
    const f = await fixture({ provenance: "Purchased", restrictions: NONE });
    expect((await f.remove("cannotTransfer")).ok).toBe(true);
    expect(await f.restrictions()).toEqual(NONE);
  });

  it("frees a guest ticket for transfer: the holder can then transfer it", async () => {
    const f = await fixture({ restrictions: BOTH });
    await f.remove("cannotTransfer");
    const transfer = {
      ...envelope(),
      kind: "transferTicket" as const,
      event: f.event,
      ticket: f.ticket,
      receiver: id32<AccountId>(),
    };
    expect((await execute(f.caps, profile, await sign(f.holder, transfer))).ok).toBe(true);
  });

  it.each(["Sealed", "Cancelled"] as const)(
    "a %s event's ticket may still be freed",
    async (status) => {
      const f = await fixture({ status });
      expect((await f.remove("cannotTransfer")).ok).toBe(true);
      expect(await f.restrictions()).toEqual(RESALE_ONLY);
    },
  );

  it("INV-16: a Finished event's ticket stays as it is", async () => {
    const f = await fixture({ status: "Finished" });
    expect(codeOf(await f.remove("cannotTransfer"))).toBe("ERR-EventFinished");
    expect(await f.restrictions()).toEqual(BOTH);
  });

  it("ERR-NotOwner: only the event's owner — not the holder — removes a restriction", async () => {
    const f = await fixture();
    expect(codeOf(await f.remove("cannotTransfer", f.holder))).toBe("ERR-NotOwner");
    const stranger = await registered(f.caps);
    expect(codeOf(await f.remove("cannotTransfer", stranger))).toBe("ERR-NotOwner");
    expect(await f.restrictions()).toEqual(BOTH);
  });

  it("ERR-NotOwner is checked even when the flag is already clear", async () => {
    const f = await fixture({ restrictions: NONE });
    expect(codeOf(await f.remove("cannotTransfer", f.holder))).toBe("ERR-NotOwner");
    expect(f.caps.log()).toHaveLength(0);
  });

  it("ERR-TicketNotFound: a ticket named with the wrong event (plan §5.7a)", async () => {
    const f = await fixture();
    const other = await fixture();
    expect(codeOf(await f.remove("cannotTransfer", f.organiser, other.ticket))).toBe(
      "ERR-TicketNotFound",
    );
  });
});
