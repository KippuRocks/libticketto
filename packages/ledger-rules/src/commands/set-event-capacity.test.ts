// T-008-05: setEventCapacity (features/008-ledger-rules/plan.md §5.2; SPEC.md US-A6,
// REQ-EV-4–REQ-EV-8, INV-11).

import type {
  Count,
  EventStatus,
  ProofId,
  Result,
  SetEventCapacity,
  SignedCommand,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities, type FakeCapabilities } from "../../test/fake-capabilities.js";
import {
  createEventCommand,
  envelope,
  profile,
  registered,
  sign,
  type TestCredential,
} from "../../test/fixtures.js";
import type { EventRecord } from "../capabilities.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const PROOF = "0f00d5" as ProofId;

interface Fixture {
  readonly caps: FakeCapabilities;
  readonly organiser: TestCredential;
  readonly event: EventRecord;
  setCapacity(
    capacity: Count | null,
    proof?: ProofId | null,
    signer?: TestCredential,
  ): Promise<Result<unknown>>;
  capacity(): Promise<Count | null | undefined>;
}

async function fixture(
  options: {
    readonly capacity?: Count | null;
    readonly issued?: Count;
    readonly status?: EventStatus;
  } = {},
): Promise<Fixture> {
  const caps = createFakeCapabilities();
  const organiser = await registered(caps);
  const create = createEventCommand(organiser.account, { capacity: options.capacity ?? null });
  if (!(await execute(caps, profile, await sign(organiser, create))).ok) throw new Error("fixture");
  const created = (await caps.registry.getEvent(create.event)) as EventRecord;
  await caps.registry.putEvent({
    ...created,
    issued: options.issued ?? 0,
    status: options.status ?? "Active",
  });
  const event = (await caps.registry.getEvent(create.event)) as EventRecord;
  return {
    caps,
    organiser,
    event,
    setCapacity: async (capacity, proof = null, signer = organiser) => {
      const command: SetEventCapacity = {
        ...envelope(),
        kind: "setEventCapacity",
        event: event.id,
        capacity,
        proof,
      };
      return execute(caps, profile, await sign(signer, command));
    },
    capacity: async () => (await caps.registry.getEvent(event.id))?.maxCapacity,
  };
}

describe("setEventCapacity (US-A6)", () => {
  it.each([10, 15, 100])(
    "AC-A6.1: with issued = 10, setting capacity to %i succeeds",
    async (capacity) => {
      const f = await fixture({ capacity: 100, issued: 10 });
      expect((await f.setCapacity(capacity)).ok).toBe(true);
      expect(await f.capacity()).toBe(capacity);
    },
  );

  it("AC-A6.2: setting capacity below issued fails with ERR-CapacityBelowIssuance, changing nothing", async () => {
    const f = await fixture({ capacity: 100, issued: 10 });
    const before = await f.caps.registry.getEvent(f.event.id);
    expect(codeOf(await f.setCapacity(9, PROOF))).toBe("ERR-CapacityBelowIssuance");
    expect(await f.caps.registry.getEvent(f.event.id)).toEqual(before);
    expect(f.caps.log()).toHaveLength(1);
  });

  it("AC-A6.3: raising capacity without a proof fails with ERR-CapacityProofRequired", async () => {
    const f = await fixture({ capacity: 100, issued: 10 });
    expect(codeOf(await f.setCapacity(101))).toBe("ERR-CapacityProofRequired");
    expect(await f.capacity()).toBe(100);
  });

  it("REQ-EV-7: removing the bound counts as an increase and needs a proof", async () => {
    const f = await fixture({ capacity: 100 });
    expect(codeOf(await f.setCapacity(null))).toBe("ERR-CapacityProofRequired");
    expect((await f.setCapacity(null, PROOF)).ok).toBe(true);
    expect(await f.capacity()).toBeNull();
  });

  it("AC-A6.4: raising capacity with a proof succeeds, and the log records which proof", async () => {
    const f = await fixture({ capacity: 100, issued: 10 });
    expect((await f.setCapacity(250, PROOF)).ok).toBe(true);
    expect(await f.capacity()).toBe(250);
    const entry = f.caps.log().at(-1)?.entry as SignedCommand;
    expect(entry.command).toMatchObject({ kind: "setEventCapacity", capacity: 250, proof: PROOF });
  });

  it.each(["Sealed", "Cancelled", "Finished"] as const)(
    "AC-A6.5: any capacity change against a %s event fails",
    async (status) => {
      const code = {
        Sealed: "ERR-EventSealed",
        Cancelled: "ERR-EventCancelled",
        Finished: "ERR-EventFinished",
      }[status];
      const f = await fixture({ capacity: 100, issued: 10, status });
      expect(codeOf(await f.setCapacity(50))).toBe(code);
      expect(codeOf(await f.setCapacity(200, PROOF))).toBe(code);
      expect(await f.capacity()).toBe(100);
    },
  );

  it("REQ-EV-4: lowering capacity to exactly the issued floor needs no proof", async () => {
    const f = await fixture({ capacity: 100, issued: 40 });
    expect((await f.setCapacity(40)).ok).toBe(true);
    expect(await f.capacity()).toBe(40);
  });

  it("bounding an unbounded event at or above issued is a decrease, and needs no proof", async () => {
    const f = await fixture({ capacity: null, issued: 5 });
    expect((await f.setCapacity(5)).ok).toBe(true);
    expect(await f.capacity()).toBe(5);
  });

  it("ERR-CapacityBelowIssuance: bounding an unbounded event below issued", async () => {
    const f = await fixture({ capacity: null, issued: 5 });
    expect(codeOf(await f.setCapacity(4))).toBe("ERR-CapacityBelowIssuance");
  });

  it("setting the same capacity is not an increase", async () => {
    const f = await fixture({ capacity: 100 });
    expect((await f.setCapacity(100)).ok).toBe(true);
    const unbounded = await fixture({ capacity: null });
    expect((await unbounded.setCapacity(null)).ok).toBe(true);
  });

  it("a proof on a decrease is accepted and stays in the log entry", async () => {
    const f = await fixture({ capacity: 100 });
    expect((await f.setCapacity(80, PROOF)).ok).toBe(true);
    const entry = f.caps.log().at(-1)?.entry as SignedCommand;
    expect(entry.command).toMatchObject({ proof: PROOF });
  });

  it("ERR-NotOwner: a signer who does not own the event", async () => {
    const f = await fixture({ capacity: 100 });
    const stranger = await registered(f.caps);
    expect(codeOf(await f.setCapacity(50, null, stranger))).toBe("ERR-NotOwner");
  });

  describe("check order (plan §5.2)", () => {
    it("ownership before status", async () => {
      const f = await fixture({ capacity: 100, status: "Sealed" });
      const stranger = await registered(f.caps);
      expect(codeOf(await f.setCapacity(50, null, stranger))).toBe("ERR-NotOwner");
    });

    it("status before the issued floor", async () => {
      const f = await fixture({ capacity: 100, issued: 10, status: "Cancelled" });
      expect(codeOf(await f.setCapacity(5))).toBe("ERR-EventCancelled");
    });

    it("the issued floor before the proof", async () => {
      const f = await fixture({ capacity: 5, issued: 10 });
      expect(codeOf(await f.setCapacity(8))).toBe("ERR-CapacityBelowIssuance");
    });
  });
});
