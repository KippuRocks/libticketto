# @ticketto/backend-memory

The in-memory reference backend, independent of the hosted one, and the slow-backend decorator.

Owned by `F-005`. Serves `REQ-MG-1`.

**Status:** the in-memory `C3` capabilities (`T-005-01`) and the `C8` port over
`ledger-rules` (`T-005-02`) are implemented. The log reader, assurance
declaration, test controls, export and the slow decorator are not yet: the log
reader and assurance throw until their tasks land.

## Backend (`C8`)

`createMemoryBackend({ profile, clock? })` runs `@ticketto/ledger-rules` in
process, over fresh in-memory capabilities (`AD-25`):

| | |
|---|---|
| `submit` | Reports `submitted` before it returns — with the command's operation id, or a pass's id — and settles only on a later microtask, never synchronously (plan §5.2, `NFR-9`). A §10 error from the rules rejects the submission; a defect fails it |
| `query` | The rules' point queries |

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

Nothing is persisted, and nothing past its retention is forgotten.

| | |
|---|---|
| Runs on | Node 24, CI |
| May depend on | `sdk`, `ledger-rules` and `log`. Must never depend on `binding-offchain`. |

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
