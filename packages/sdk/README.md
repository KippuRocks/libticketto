# @ticketto/sdk

The Ticketto SDK surface: commands, queries, errors, write completion, the log reader, and the backend port.

Contracts `C1` (SDK surface) and `C8` (backend port). Owned by `F-002`.

**Status:** being built by `F-002` for `M0`. The surface is not agreed until the API report lands (`T-002-10`).

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes), browser |
| May depend on | Nothing internal. Must never depend on a backend, `ledger-rules` or `profile-v0`. |

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
