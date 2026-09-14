# spec-codegen

Generates the parts of `@ticketto/sdk` that must never disagree with the
specification (features/002-sdk/plan.md §5.3, §5.9):

- `TickettoErrorCode` and `TICKETTO_ERROR_CODES` — every live error of SPEC.md
  §10. Tombstoned rows ("Renamed …", "Withdrawn …") are excluded.
- `TICKETTO_ERROR_ORIGINS` — each code tagged `ledger`, `platform` or `binding`,
  read from §10's note on where errors arise.
- `InvariantId` and `INVARIANT_IDS` — every live invariant of §9.

Output: `packages/sdk/src/generated/spec.ts`. Do not edit it by hand.

## The vendored spec

CI cannot read the private `KippuRocks/kippu-docs` repository, so the spec is
vendored at `spec/SPEC.md`. `spec/source.json` records where it came from — the
repository, the commit, the ref it was taken from — and its sha256.

```sh
pnpm build
pnpm spec:check                                          # CI: pin and generated code agree
pnpm spec:generate                                       # rewrite the generated file
pnpm spec:vendor <kippu-docs checkout> <commit> <ref>    # take SPEC.md at a commit, pin it, regenerate
```

`check` fails when `spec/SPEC.md` no longer matches its pinned sha256 (it was
edited instead of re-vendored), or when the generated file differs from what the
spec generates (a §9 or §10 row changed and nobody regenerated).
