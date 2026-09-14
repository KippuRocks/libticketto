# @ticketto/backend-memory

The in-memory reference backend, independent of the hosted one, and the slow-backend decorator.

Owned by `F-005`. Serves `REQ-MG-1`.

**Status:** the in-memory `C3` capabilities are implemented (`T-005-01`). The
`C8` port, log reader, assurance declaration, test controls, export and the
slow decorator are not yet.

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
