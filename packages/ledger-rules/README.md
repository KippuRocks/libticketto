# @ticketto/ledger-rules

The ledger's rules — commands, invariants and errors — implemented once over the capability interfaces, and run by whatever holds authoritative ledger state.

Contract `C3`. Owned by `F-008`.

**Status:** the `C3` capability interfaces are declared (`T-008-01`). No command
handler is implemented yet.

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes) |
| May depend on | `sdk` (types) and `profile-v0`. Must never depend on a backend, nor perform I/O. |

## Capabilities (`C3`)

A store supplies the rules with `Capabilities` (`REQ-SDK-3`):

| | |
|---|---|
| `registry` | Ledger state in domain terms: events, credential registrations by account, tickets and their facts, consumed pass ids with retention, operation ids with expiry and a digest of the signed input, and appending logical log records (with a pass's claimed `presentedAt`) |
| `clock` | A monotonic current timestamp |
| `value` | Declared for settlement beyond V0; nothing implements it in V0 |
| `transaction(fn)` | Runs `fn` in one serialisable transaction: its writes commit together when `fn` resolves, and none does when it rejects |

`backend-memory` (`F-005`) and `ticketto-offchain` (`F-010`) implement them. The
package's own unit tests run against the fakes in `test/fake-capabilities.ts`,
which are not exported.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
