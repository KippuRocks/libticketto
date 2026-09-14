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
   and runs `changeset version --snapshot canary`.
3. Packs each package with `pnpm pack`, which rewrites `workspace:` ranges.
4. Creates a client in the system temporary directory, outside any workspace,
   installs every tarball — with `pnpm.overrides` so internal dependencies
   resolve to the tarballs too — then imports each package by name under Node
   and typechecks the same imports with TypeScript (`nodenext`).

CI runs it on every change (`canary` job in `.github/workflows/ci.yml`).
