// T-008-14: registerCredential, and the first-registration case of step 3
// (features/008-ledger-rules/plan.md §5.2, §5.7a; SPEC.md REQ-CP-6, REQ-SP-1).

import {
  type SimulatedWebAuthnCredential,
  simulatedWebAuthnSigner,
} from "@ticketto/profile-v0/testing";
import type {
  AccountId,
  CredentialId,
  Receipt,
  RegisterCredential,
  Registration,
  Result,
} from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities } from "../../test/fake-capabilities.js";
import {
  createEventCommand,
  credential,
  envelope,
  profile,
  registered,
  sign,
} from "../../test/fixtures.js";
import { execute } from "../execute.js";

function codeOf(result: Result<unknown>): string {
  return result.ok ? "accepted" : result.error.code;
}

const RP_ID = "kippu.test";

/** A holder's device; devices sharing a user id belong to one account. */
function device(userId?: string): SimulatedWebAuthnCredential & { credential: CredentialId } {
  const created = simulatedWebAuthnSigner(
    userId === undefined ? { rpId: RP_ID } : { rpId: RP_ID, userId },
  );
  const named = profile.registrationAccount(created.registration);
  if (!named.ok) throw new Error("a simulated device always registers");
  return { ...created, credential: named.value.credential };
}

function registration(account: AccountId, bytes: Registration): RegisterCredential {
  return { ...envelope(), kind: "registerCredential", account, registration: bytes };
}

describe("registerCredential — the first registration", () => {
  it("REQ-CP-6: a holder's first registration, authorised by the new device, creates the account", async () => {
    const caps = createFakeCapabilities();
    const phone = device();
    const account = phone.signer.account;
    const signed = await sign(phone, registration(account, phone.registration));

    const result = (await execute(caps, profile, signed)) as { ok: true; value: Receipt };
    expect(result.ok).toBe(true);
    expect(await caps.registry.getRegistrations(account)).toEqual([
      { credential: phone.credential, registration: phone.registration },
    ]);
    expect(caps.log()).toEqual([
      { cursor: result.value.cursor, recordedAt: 0, event: null, entry: signed, presentedAt: null },
    ]);
  });

  it("REQ-CP-6: a p256 key's first registration creates its account, which can then act", async () => {
    const caps = createFakeCapabilities();
    const key = credential();
    expect(
      (await execute(caps, profile, await sign(key, registration(key.account, key.registration))))
        .ok,
    ).toBe(true);

    const create = createEventCommand(key.account);
    expect((await execute(caps, profile, await sign(key, create))).ok).toBe(true);
  });

  it("ERR-InvalidAuthorisation: before registering, an account can do nothing else", async () => {
    const caps = createFakeCapabilities();
    const key = credential();
    const create = createEventCommand(key.account);
    expect(codeOf(await execute(caps, profile, await sign(key, create)))).toBe(
      "ERR-InvalidAuthorisation",
    );
  });

  it("ERR-InvalidAuthorisation: a first registration signed by another device of the account", async () => {
    const caps = createFakeCapabilities();
    const phone = device();
    const laptop = device(phone.userId);
    const signed = await sign(laptop, registration(phone.signer.account, phone.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(phone.signer.account)).toEqual([]);
  });

  it("ERR-InvalidAuthorisation: a first registration naming a different account", async () => {
    const caps = createFakeCapabilities();
    const mine = device();
    const theirs = device();
    const signed = await sign(theirs, registration(mine.signer.account, theirs.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(mine.signer.account)).toEqual([]);
    expect(await caps.registry.getRegistrations(theirs.signer.account)).toEqual([]);
  });

  it("ERR-InvalidAuthorisation: another account's registered credential cannot create an account", async () => {
    const caps = createFakeCapabilities();
    const sponsor = await registered(caps);
    const holder = device();
    const signed = await sign(sponsor, registration(holder.signer.account, holder.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(holder.signer.account)).toEqual([]);
  });

  it("ERR-InvalidAuthorisation: a malformed registration", async () => {
    const caps = createFakeCapabilities();
    const phone = device();
    const signed = await sign(
      phone,
      registration(phone.signer.account, new Uint8Array([1, 2, 3]) as Registration),
    );
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
  });
});

describe("registerCredential — a further device", () => {
  async function holderWithPhone() {
    const caps = createFakeCapabilities();
    const phone = device();
    const first = await sign(phone, registration(phone.signer.account, phone.registration));
    const result = await execute(caps, profile, first);
    if (!result.ok) throw new Error(`first registration: ${result.error.code}`);
    return { caps, phone, account: phone.signer.account };
  }

  it("REQ-CP-6: a second device registers with an existing credential's authorisation, and can then act", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const laptop = device(phone.userId);
    expect(laptop.signer.account).toBe(account);

    const signed = await sign(phone, registration(account, laptop.registration));
    expect((await execute(caps, profile, signed)).ok).toBe(true);
    expect(await caps.registry.getRegistrations(account)).toEqual([
      { credential: phone.credential, registration: phone.registration },
      { credential: laptop.credential, registration: laptop.registration },
    ]);

    const create = createEventCommand(account);
    expect((await execute(caps, profile, await sign(laptop, create))).ok).toBe(true);
  });

  it("ERR-InvalidAuthorisation: a second device cannot authorise its own registration", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const intruder = device(phone.userId);
    const signed = await sign(intruder, registration(account, intruder.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(account)).toHaveLength(1);
  });

  it("ERR-InvalidAuthorisation: another account's credential cannot add a device", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const other = await registered(caps);
    const laptop = device(phone.userId);
    const signed = await sign(other, registration(account, laptop.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(account)).toHaveLength(1);
  });

  it("ERR-InvalidAuthorisation: a registration naming a different account than the one registered to", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const stranger = device();
    const signed = await sign(phone, registration(account, stranger.registration));
    expect(codeOf(await execute(caps, profile, signed))).toBe("ERR-InvalidAuthorisation");
    expect(await caps.registry.getRegistrations(account)).toHaveLength(1);
    expect(await caps.registry.getRegistrations(stranger.signer.account)).toEqual([]);
  });

  it("REQ-CP-6: re-registering an identical credential is accepted, changes no state, and is logged", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const before = await caps.registry.getRegistrations(account);

    const again = await sign(phone, registration(account, phone.registration));
    const result = (await execute(caps, profile, again)) as { ok: true; value: Receipt };
    expect(result.ok).toBe(true);
    expect(await caps.registry.getRegistrations(account)).toEqual(before);
    expect(caps.log()).toHaveLength(2);
    expect(caps.log()[1]).toMatchObject({ cursor: result.value.cursor, entry: again, event: null });
  });

  it("REQ-CM-1: an identical replay of a registration returns the original receipt", async () => {
    const { caps, phone, account } = await holderWithPhone();
    const laptop = device(phone.userId);
    const signed = await sign(phone, registration(account, laptop.registration));
    const first = await execute(caps, profile, signed);
    expect(await execute(caps, profile, signed)).toEqual(first);
    expect(await caps.registry.getRegistrations(account)).toHaveLength(2);
    expect(caps.log()).toHaveLength(2);
  });
});
