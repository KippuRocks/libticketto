# libticketto

The Ticketto monorepo: SDK surface, V0 cryptographic profile, ledger rules, conformance suite, in-memory reference backend, log, and backend bindings. Features F-001–F-008.

This repository was reset for the V0 rebuild. The previous implementation is
preserved under the tag `legacy`.

Everything here is built from the Kippu specification and plan, in
`kippurocks/kippu-docs`: `SPEC.md` decides behaviour, `PLAN.md` and
`features/` decide how it is built. Work is tracked as one issue per feature
per milestone.

## Packages

| Package | What it is |
|---|---|
| [`@ticketto/sdk`](packages/sdk) | SDK surface and backend port (`C1`, `C8`) |
| [`@ticketto/profile-v0`](packages/profile-v0) | V0 cryptographic profile (`C2`) |
| [`@ticketto/ledger-rules`](packages/ledger-rules) | The ledger's rules over capability interfaces (`C3`) |
| [`@ticketto/backend-memory`](packages/backend-memory) | In-memory reference backend |
| [`@ticketto/log`](packages/log) | Published log, checkpoints, export and import (`C7`) |
| [`@ticketto/binding-offchain`](packages/binding-offchain) | Binding to the hosted `ticketto-offchain` service |
| [`@ticketto/conformance`](packages/conformance) | Shared conformance suite, run against every backend |
| [`@ticketto/rx`](packages/rx) | Optional RxJS adapter |

Every package is a shell until its owning feature lands.

## Development

Requires Node.js 24 or later and pnpm (the version is pinned in
`package.json`'s `packageManager` field; `corepack enable` or a matching global
install will pick it up). Installing on an older Node fails by design.

```sh
pnpm install
pnpm build        # every package, in dependency order
pnpm typecheck
pnpm lint         # Biome: lint and formatting, read-only
pnpm format       # Biome: apply safe fixes and formatting
pnpm lint:switches  # no default-less switch over Command or TickettoErrorCode (tools/switch-default)
pnpm test         # Vitest: every package and tool, plus workspace checks (build first)
pnpm boundaries   # package dependency rules (tools/boundaries)
pnpm api:check    # the SDK's exported surface matches packages/sdk/api/sdk.api.md (api:update to acknowledge)
pnpm spec:check   # generated SDK error codes and invariant ids match spec/SPEC.md (tools/spec-codegen)
pnpm hermes       # Metro + hermesc bundle of the React Native path (tools/hermes-bundle)
pnpm canary       # snapshot release, packed and installed into a throwaway client
pnpm conformance-matrix discover   # backends registered for the conformance suite
```

Releases use Changesets; see [`.changeset/README.md`](.changeset/README.md).
Nothing is published yet.

CI (`.github/workflows/ci.yml`, Node 24) runs all of these on every pull request
and on `main`.

Vitest runs one project per package and tool. `test/workspace.test.ts` holds the
conventions every member must keep: ESM only, Node 24 as the engine floor, the
shared strict TypeScript base, and at least one test of its own.

The workspace is ESM only and TypeScript strict. Every package extends
`tsconfig.base.json`, which loads no ambient type packages (`"types": []`), so a
package that needs Node's globals must say so explicitly.
