# canary

Proves a canary release of every `@ticketto/*` package is installable from a
client repository, without publishing anything.

```sh
pnpm build
pnpm canary [out-dir]     # tarballs land in .canary/ by default
```

1. Adds a temporary git worktree at `HEAD`, so your checkout is never touched
   (uncommitted changes are not part of the canary).
2. Installs and builds there, writes a changeset bumping every public package,
   and runs `changeset version --snapshot canary` with changelog generation off.
   Generating a changelog makes Changesets find the commit that added each
   pending changeset, which in a shallow clone (CI's checkout) means
   `git fetch --deepen` against the remote; the canary makes no git network
   call, and forbids git's network transports while versioning.
3. Packs each package with `pnpm pack`, which rewrites `workspace:` ranges.
4. Creates a client in the system temporary directory, outside any workspace,
   installs every tarball — with `pnpm.overrides` so internal dependencies
   resolve to the tarballs too — then imports each package by name under Node
   and typechecks the same imports with TypeScript (`nodenext`).

Every step runs non-interactively (stdin closed, `CI=true`, git terminal
prompts off) under its own timeout. The log names each step as it starts and
ends; a step that reaches its bound is killed with its descendants and fails the
canary with the step, its directory and its output so far.

CI runs it on every change (`canary` job in `.github/workflows/ci.yml`).
