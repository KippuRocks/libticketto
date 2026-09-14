# boundaries

Enforces the package dependency rules of `features/001-workspace/plan.md` §5.2
(in `kippurocks/kippu-docs`), on top of pnpm's strict resolution. Traces
`REQ-SDK-2`: a backend concept cannot leak into the SDK surface unnoticed.

```sh
pnpm build
pnpm boundaries            # exits 1 on any violation
```

It reads every `packages/*/package.json` and parses every source file in the
package (outside `node_modules`, `dist` and `coverage`), collecting static and
dynamic imports, re-exports, `require` calls and `import("…")` types.

## How the table is read

- **May depend on** is exhaustive for what a package ships: `dependencies`,
  `peerDependencies`, `optionalDependencies`, and imports in non-test sources.
- **Must never depend on** binds everything, `devDependencies` and test files
  included. Test files are `*.test.*`, `*.spec.*`, `*.config.*`, and anything
  under `test/`, `tests/`, `__tests__/` or `fixtures/`.
- **Types only** allows `import type`, `export type` and `import("…")` types.
  `import { type X }` is refused: under `verbatimModuleSyntax` it still emits an
  import.
- **Any backend** is every `@ticketto/backend-*` and `@ticketto/binding-*`.
- **Any I/O** is any Node.js built-in module. Globals such as `fetch` are
  refused by the base TypeScript configuration, which loads no DOM or Node
  types.
- A relative import may not leave its package.
- A package with no row in §5.2 — today `@ticketto/log` and `@ticketto/rx` — is
  listed and not checked. Its rule belongs in the plan, not here.

The rules live in [`src/rules.ts`](src/rules.ts); the tests in
[`src/check.test.ts`](src/check.test.ts) include the deliberate
`sdk → backend-memory` import that must fail.
