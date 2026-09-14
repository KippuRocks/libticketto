# switch-default

Forbids a `switch` over `Command` kinds or `TickettoErrorCode` values that has
no `default` (features/002-sdk/plan.md §5.6, `REQ-SDK-1`).

Beyond-V0 commands and new §10 errors will join those unions. A consumer that
switches over every member without a default breaks when that happens, so
every such switch must keep a default — then those additions are non-breaking
by construction.

Biome cannot see types. This check recognises a switch by its case labels: a
string literal that is a `Command` kind (read from
`packages/sdk/src/commands.ts`) or a generated error code (read from
`packages/sdk/src/generated/spec.ts`) marks it. It scans every `src/` under
`packages/` and `tools/`, and the workspace's `test/`.

```sh
pnpm build
pnpm lint:switches
```

`fixtures/` holds the switches its tests prove it rejects and accepts.
