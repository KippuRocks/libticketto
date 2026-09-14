import type { SignedCommand } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { type FakeBackend, fakeBackend } from "../test/fake-backend.js";
import { profileV0Fixtures } from "./fixtures/profile-v0.js";
import type { ConformanceTarget } from "./harness.js";
import { milestoneError, runSuites, suite, titleError } from "./suite.js";
import { OPERATION_LIFETIME } from "./world.js";

// T-004-01: the harness runs a trivial suite against a fake backend. The fake
// enforces nothing, so this proves the harness and fixtures, not a backend.

const fixtures = profileV0Fixtures();
const made: FakeBackend[] = [];
const target: ConformanceTarget = {
  name: "fake backend × profile-v0",
  makeBackend: async () => {
    const backend = await fakeBackend();
    made.push(backend);
    return backend;
  },
  ...fixtures,
};

runSuites(
  target,
  [
    suite("harness", (test) => {
      test(
        "harness: a fresh world registers the organiser and every holder, each self-signed",
        "M1",
        async (world) => {
          const backend = made.at(-1) as FakeBackend;
          expect(world.backend).toBe(backend);
          const commands = backend.submitted.map(({ input }) => {
            expect(input.kind).toBe("command");
            return (input as { signed: SignedCommand }).signed;
          });
          const credentials = [world.signers.organiser, ...world.signers.holders];
          expect(commands).toHaveLength(credentials.length);
          for (const [i, { command, authorisation }] of commands.entries()) {
            const credential = credentials[i];
            expect(command.kind).toBe("registerCredential");
            if (command.kind !== "registerCredential" || credential === undefined) return;
            expect(command.account).toBe(credential.signer.account);
            // Signed over the profile's signing payload, which carries its domain tag.
            expect(
              world.profile.verify(
                credential.registration,
                world.profile.encodeCommand(command),
                authorisation,
              ),
            ).toBe(true);
          }
        },
      );

      test(
        "harness: the SDK runs on the backend's settable clock and seeded randomness",
        "M1",
        async (world) => {
          world.backend.clock.set(1_000_000);
          world.backend.clock.advance(500);
          const { submission } = world.ticketto.createEvent(world.organiser, {
            salt: world.identifiers.salt(0),
            zones: [{ id: world.identifiers.zone(0), kind: "Seated" }],
            capacity: null,
            metadata: null,
          });
          const result = await submission;
          expect(result.ok).toBe(true);
          const last = (made.at(-1) as FakeBackend).submitted.at(-1);
          expect(last?.input.kind).toBe("command");
          const command = (last as { input: { signed: SignedCommand } }).input.signed.command;
          expect(command.expiresAt).toBe(1_000_500 + OPERATION_LIFETIME);

          const again = await fakeBackend();
          expect(again.randomBytes(16)).toEqual((await fakeBackend()).randomBytes(16));
        },
      );
    }),
  ],
  { through: "M1" },
);

// §5.2a: a run goes through one milestone. The M4-tagged test would fail if it
// ran; through M1 it is registered as skipped, so this file passes.
runSuites(
  target,
  [
    suite("milestones", (test) => {
      test("milestones: a test tagged with the run's milestone runs", "M1", async (world) => {
        expect(world.backend).toBeDefined();
      });
      test("milestones: a test tagged with a later milestone does not run", "M4", async () => {
        expect.fail("an M4 test ran in a run through M1");
      });
    }),
  ],
  { through: "M1" },
);

describe("suite titles", () => {
  it("refuses a title that does not begin with its suite's identifier", () => {
    expect(titleError("INV-4", "INV-4: issuance stops at capacity")).toBeUndefined();
    expect(titleError("INV-4", "issuance stops at capacity")).toMatch(/must be titled/);
    expect(titleError("INV-4", "INV-40: something else")).toMatch(/must be titled/);
  });

  it("refuses an untagged test, or one tagged with no milestone", () => {
    expect(milestoneError("INV-4: x", "M3")).toBeUndefined();
    expect(milestoneError("INV-4: x", undefined)).toMatch(/must be tagged/);
    expect(milestoneError("INV-4: x", "M9")).toMatch(/must be tagged/);
  });

  it("gives the V0 fixtures distinct accounts, and a second device on holder 0's account", () => {
    const { organiser, holders, secondDevice, stranger } = fixtures.signers;
    const accounts = [organiser, ...holders, stranger].map((c) => c.signer.account);
    expect(new Set(accounts).size).toBe(accounts.length);
    expect(secondDevice.signer.account).toBe(holders[0]?.signer.account);
    expect(secondDevice.registration).not.toEqual(holders[0]?.registration);
  });
});
