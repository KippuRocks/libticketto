# @ticketto/backend-memory

The in-memory reference backend, independent of the hosted one, and the slow-backend decorator.

Owned by `F-005`. Serves `REQ-MG-1`.

**Status:** the in-memory `C3` capabilities (`T-005-01`), the `C8` port over
`ledger-rules` (`T-005-02`), log production and the log reader (`T-005-03`),
the assurance declaration (`T-005-04`), the test controls (`T-005-05`) and
export and import (`T-005-06`) are implemented. The slow decorator is not yet.

## Backend (`C8`)

`createMemoryBackend({ profile, clock?, publication? })` runs `@ticketto/ledger-rules` in
process, over fresh in-memory capabilities (`AD-25`):

| | |
|---|---|
| `submit` | Reports `submitted` before it returns — with the command's operation id, or a pass's id — and settles only on a later microtask, never synchronously (plan §5.2, `NFR-9`). A §10 error from the rules rejects the submission; a defect fails it |
| `query` | The rules' point queries |
| `log` | `read(from, limit)` returns the records after a cursor in the total order; a cursor this log never issued, or a limit that is not a positive integer, throws. `hints()` yields the current head on subscribing, then the latest head after each commit that moves it, coalesced — cursors only, never records, as the hosted service's hint stream (`AD-17`) |
| `assurance` | `SPEC.md` §4.4's hosted column, and never more (plan §5.3): `INV-6` and `INV-7` enforced by the single in-process authority; every other invariant attested |
| `migration` | Export and import in `@ticketto/log`'s format (`C7`, `FORMAT.md` §5; `REQ-MG-3`). Export writes the records verbatim, a checkpoint signed by the `publication` key given at creation (a non-empty log without one throws), and a snapshot with consumed passes and operations still retained. Import accepts only an empty backend, refuses a malformed export, appends the records at their sequences and loads the snapshot, recomputing each event's zones in use from its tickets and each receipt's cursor from its record's sequence |

A sponsorship is accepted and not verified: that is the hosted ledger service's
concern (`F-010`).

## Capabilities (`C3`)

`createMemoryCapabilities({ clock? })` supplies `@ticketto/ledger-rules` with
`Capabilities` held in memory:

| | |
|---|---|
| `transaction(fn)` | One global async mutex: transactions run one at a time, in the order started. Writes go into a copy-on-write layer over the committed state, folded in, in one synchronous step, only when `fn` resolves — serialisable by construction (`INV-6`, `AC-E3.2`), and deliberately naive |
| `registry` | Outside a transaction, reads see the committed state and each write is a transaction of its own |
| `clock` | The clock given, or the system clock held monotonic |

Every log append is linked onto `@ticketto/log`'s hash chain (`C7`) inside its
transaction; the chain's head moves only when the transaction commits, and an
input the log cannot carry (`NFR-6`) throws, rolling the transaction back.
Nothing is persisted, and nothing past its retention is forgotten.

| | |
|---|---|
| Runs on | Node 24, CI |
| May depend on | `sdk`, `ledger-rules` and `log`. Must never depend on `binding-offchain`. |

## Test controls (`/testing`)

For tests and the conformance suite only (plan §5.4). `createTestMemoryBackend({
profile, start?, seed? })` returns the backend with the conformance suite's
`TestControls`:

| | |
|---|---|
| `clock` | The clock the rules read: `now`, `set`, `advance`. Starts at `TEST_EPOCH` unless told otherwise, and never moves backwards (`REQ-SDK-3`) |
| `randomBytes(length)` | A seeded, deterministic source for operation and pass ids — the same seed, the same sequence. Not for keys |

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
