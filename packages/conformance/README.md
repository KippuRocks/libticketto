# @ticketto/conformance

The shared conformance suite, written once against the SDK surface and run against every backend.

Owned by `F-004`. Serves `REQ-SDK-7`, `REQ-CP-5` and `NFR-8`.

**Status:** harness, `TestControls` contract, V0 signer fixtures and the V0 scope. No behaviour suites yet.

| | |
|---|---|
| Runs on | Node 24, CI |
| May depend on | `sdk` and `profile-v0`. Must never depend on a concrete backend — backends are injected. |
| Test runner | Vitest, as a peer dependency |

Test infrastructure only. The V0 fixtures hold software keys as plain bytes, derived from
labels in this package's source: never use them for a real organiser, holder or sponsor.

## Running the suite against a backend

A run is one cell of the matrix — one backend under one profile (`REQ-CP-5`):

```ts
// packages/backend-example/conformance/conformance.test.ts
import { defineConformance, profileV0Fixtures } from "@ticketto/conformance";
import { createTestBackend } from "../src/testing/index.js";

defineConformance({
  name: "backend-example × profile-v0",
  makeBackend: async () => createTestBackend(),
  ...profileV0Fixtures(),
});
```

The backend package lists `@ticketto/conformance` as a devDependency only, and registers with
the CI matrix by defining a `conformance` script that runs that file, for example
`vitest run --root . conformance` (see `tools/conformance-matrix`).

## The harness

- **`makeBackend`** returns a fresh, empty backend in test mode, once per test.
- **`TestControls`** is what every backend must offer in test mode, and nowhere else: a settable
  `clock` (`now`, `set`, `advance`) that the backend's rules read, and `randomBytes`, a seeded
  source the SDK uses for operation ids. A service offers them behind a test-mode flag that
  production refuses to start with.
- **`signers`**, from the profile under test: an organiser, at least three holders, a second
  device for the first holder's account, a stranger no world registers, and a sponsor. Every
  signer signs the profile's signing payloads.
- **`identifiers`**, from the profile under test: well-formed zone, class, position,
  discriminator, proof and salt values, so no suite invents an encoding.

Each test runs in a fresh `World`: the backend, the SDK over it on the backend's clock and
randomness, and the organiser's and holders' credentials already registered.

## Scope

`src/scope.v0.ts` lists every invariant and ledger error the V0 suite must cover, and every other
live §9 and §10 identifier with a one-line reason it is left out (`features/004-conformance/plan.md`
§5.3). A test fails when an identifier is in neither list, in both, or not live in the vendored
spec — so a spec change that adds one fails CI until it is classified.

## Suites

One suite per identifier. Every test title begins with the identifier it verifies and a colon —
`INV-13: a second ticket for the same position is rejected` — and a suite refuses a test titled
otherwise.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
