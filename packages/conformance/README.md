# @ticketto/conformance

The shared conformance suite, written once against the SDK surface and run against every backend.

Owned by `F-004`. Serves `REQ-SDK-7` and `NFR-8`.

**Status:** package shell. No behaviour is implemented yet.

| | |
|---|---|
| Runs on | Node 24, CI |
| May depend on | `sdk` and `profile-v0`. Must never depend on a concrete backend — backends are injected. |

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
