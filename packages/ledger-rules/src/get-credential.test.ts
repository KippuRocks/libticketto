// T-008-15: the getCredential query (features/008-ledger-rules/plan.md §5.3;
// SPEC.md REQ-CP-6, REQ-MG-5).

import { simulatedWebAuthnSigner } from "@ticketto/profile-v0/testing";
import type { AccountId, CredentialId, RegisterCredential, Registration } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { createFakeCapabilities } from "../test/fake-capabilities.js";
import { envelope, profile, sign } from "../test/fixtures.js";
import { execute } from "./execute.js";
import { query } from "./query.js";

const RP_ID = "kippu.test";

function device(userId?: string) {
  const created = simulatedWebAuthnSigner(
    userId === undefined ? { rpId: RP_ID } : { rpId: RP_ID, userId },
  );
  const named = profile.registrationAccount(created.registration);
  if (!named.ok) throw new Error("a simulated device always registers");
  return { ...created, account: named.value.account, credential: named.value.credential };
}

function registration(account: AccountId, bytes: Registration): RegisterCredential {
  return { ...envelope(), kind: "registerCredential", account, registration: bytes };
}

async function holderWithTwoDevices() {
  const caps = createFakeCapabilities();
  const phone = device();
  const laptop = device(phone.userId);
  for (const [signer, registered] of [
    [phone, phone],
    [phone, laptop],
  ] as const) {
    const result = await execute(
      caps,
      profile,
      await sign(signer, registration(phone.account, registered.registration)),
    );
    if (!result.ok) throw new Error(`registration: ${result.error.code}`);
  }
  return { caps, phone, laptop };
}

const getCredential = (account: AccountId, credential: CredentialId) =>
  ({ kind: "getCredential", account, credential }) as const;

describe("getCredential", () => {
  it("REQ-CP-6: returns the registration of each credential registered to the account", async () => {
    const { caps, phone, laptop } = await holderWithTwoDevices();
    expect(await query(caps, profile, getCredential(phone.account, phone.credential))).toEqual({
      ok: true,
      value: phone.registration,
    });
    expect(await query(caps, profile, getCredential(phone.account, laptop.credential))).toEqual({
      ok: true,
      value: laptop.registration,
    });
  });

  it("returns null for a credential not registered to the account", async () => {
    const { caps, phone } = await holderWithTwoDevices();
    const unregistered = device(phone.userId);
    expect(
      await query(caps, profile, getCredential(phone.account, unregistered.credential)),
    ).toEqual({ ok: true, value: null });
  });

  it("returns null for another account's credential", async () => {
    const { caps, phone } = await holderWithTwoDevices();
    const other = device();
    await execute(
      caps,
      profile,
      await sign(other, registration(other.account, other.registration)),
    );

    expect(await query(caps, profile, getCredential(phone.account, other.credential))).toEqual({
      ok: true,
      value: null,
    });
    expect(await query(caps, profile, getCredential(other.account, phone.credential))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("returns null for an account with no registration, and writes nothing (REQ-Q-1)", async () => {
    const caps = createFakeCapabilities();
    const nobody = device();
    expect(await query(caps, profile, getCredential(nobody.account, nobody.credential))).toEqual({
      ok: true,
      value: null,
    });
    expect(caps.log()).toHaveLength(0);
    expect(await caps.registry.getRegistrations(nobody.account)).toEqual([]);
  });
});
