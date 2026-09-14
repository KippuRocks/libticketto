# Changesets

Releases of the `@ticketto/*` packages are driven by
[Changesets](https://github.com/changesets/changesets). Every pull request that
changes a published package adds a changeset:

```sh
pnpm changeset
```

Private workspace members (`tools/*`) are never versioned or released.

| Command | What it does |
|---|---|
| `pnpm changeset` | Record a change and its semver bump |
| `pnpm version-packages` | Apply pending changesets: bump versions, write changelogs |
| `pnpm release` | Build and publish — **not enabled**, see below |
| `pnpm canary` | Snapshot every package, `pnpm pack` it, install it into a throwaway client; publishes nothing |

## Publishing is not enabled

The package registry is undecided. Until it is, nothing is published:
`.github/workflows/release.yml` runs only when the repository variable
`TICKETTO_RELEASES_ENABLED` is `true`, and `access` stays at its default.
Enabling releases needs the registry chosen, `publishConfig` (or an `.npmrc`)
pointing at it, the package scope settled to match it, and a token.
