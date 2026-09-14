# ticketto-trace

The traceability gate of `PLAN.md` §6, owned by `F-004` (`features/004-conformance/plan.md`
§5.5). Serves `NFR-8` and `SPEC.md` §15.

```sh
ticketto-trace --spec <SPEC.md> --scope v0 --results <file>... [--allow <file>]
```

- **`--spec`** — the `SPEC.md` to trace against, at the commit the repository pins (in
  libticketto, `spec/SPEC.md`, pinned by `spec/source.json`).
- **`--scope v0`** — what is required: every live acceptance criterion of a V0 story (§15's
  release-scope table), and every invariant and error in `@ticketto/conformance`'s `SCOPE_V0`.
  The scope must classify exactly the invariants and errors the given spec defines.
- **`--results`** — one or more Vitest result files, `--reporter=json` or `--reporter=junit`,
  from any repository. Results from several repositories are combined at milestone time.
- **`--allow`** — identifiers this repository is not yet required to cover, one per line, `#`
  for comments: a gate story before its milestone, say. Each must be live in the spec.

A test *names* an identifier when its title, or the name of a block around it, begins with one
— `INV-13: a second ticket for the same position is rejected`. Skipped and to-do tests name
nothing.

It exits **1** when a required identifier has no test, when a test names an identifier the spec
does not define, or when a test names a tombstoned identifier — one renamed or withdrawn by an
amendment, including identifiers withdrawn with a story (`AC-E4.1`–`AC-E4.4`). It exits **2**
on a usage error.

```sh
pnpm build
pnpm vitest run --reporter=json --outputFile.json=results.json
pnpm trace --spec spec/SPEC.md --scope v0 --results results.json
```

Not yet run in libticketto's CI: most V0 acceptance criteria are covered in other repositories,
and the conformance suites land milestone by milestone.
