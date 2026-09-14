# libticketto

The Ticketto monorepo: SDK surface, V0 cryptographic profile, ledger rules, conformance suite, in-memory reference backend, log, and backend bindings. Features F-001–F-008.

This repository was reset for the V0 rebuild. The previous implementation is
preserved under the tag `legacy`.

Everything here is built from the Kippu specification and plan, in
`kippurocks/kippu-docs`: `SPEC.md` decides behaviour, `PLAN.md` and
`features/` decide how it is built. Work is tracked as one issue per feature
per milestone.

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
pnpm test         # Vitest: every package and tool, plus workspace checks
```

Vitest runs one project per package and tool. `test/workspace.test.ts` holds the
conventions every member must keep: ESM only, Node 24 as the engine floor, the
shared strict TypeScript base, and at least one test of its own.

The workspace is ESM only and TypeScript strict. Every package extends
`tsconfig.base.json`, which loads no ambient type packages (`"types": []`), so a
package that needs Node's globals must say so explicitly.
