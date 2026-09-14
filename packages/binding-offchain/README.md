# @ticketto/binding-offchain

The SDK binding to the hosted `ticketto-offchain` ledger service.

Owned by `F-007`.

**Status:** the `C4` client (`T-007-01`) and `submit` over it (`T-007-02`). The rest
of the `C8` backend port — queries, the log reader and hints, assurance — is not
implemented yet (`T-007-03`).

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes) |
| May depend on | `sdk` and `profile-v0`. Must never depend on `ledger-rules` or `backend-memory`. |

## The `C4` client

`createC4Client({ url })` speaks `C4`, the private wire protocol specified in
`protocol/C4.md` of `KippuRocks/ticketto-offchain`, with `fetch` alone: no Node
streams, no native modules, no `TextDecoder` and no `crypto` of its own, so it
runs unchanged on Node and in React Native. It uses the platform's `fetch` unless one
is passed.

Each method sends one request and returns the row of `C4.md` §4.3 the answer
falls in — `submitted`, `pending`, `settled`, `rejected`, `value`, `hints`,
`resubmit`, `retry` or `defect`. It never retries, resubmits or waits by itself;
those decisions, and the translation onto the SDK surface, belong to the port.

- **Requests** are built by pure functions (`submitRequest`, `operationRequest`,
  `queryRequest`, `logRequest`, …), which refuse to build anything the service
  would answer `malformed`.
- **Signed inputs** are passed as the profile's signed-input bytes, and carried
  as hex without being re-encoded.
- **The hint stream** needs a streamed response body, which Node's `fetch` has
  and React Native's does not; React Native readers poll
  `GET /v0/checkpoints/latest` instead (`F-007` §5).

## Submitting

`createOffchainSubmit({ client })` is `Backend.submit` over `C4`. It frames the
signed input with `@ticketto/profile-v0`'s signed-input encoder, reports
`submitted` on the service's `202`, and long-polls `GET /v0/operations/{id}` until
the write settles or is rejected — however long that takes (`NFR-9`).

- **Retries resend the identical request.** A dropped connection, a timeout, `503`
  or a proxy's `5xx` is retried with exponential backoff (honouring
  `Retry-After`), always with the bytes first sent; so is a poll the service
  answers `operation-unknown`. The service identifies a submission by those bytes,
  so the input reaches the rules once (`REQ-CM-1`).
- **A poll times out** after `wait` plus a margin (10 s by default) and is
  repeated; a `pending` answer is progress and never backed off.
- **When the retry budget is spent**, the submission rejects with
  `ERR-LedgerUnavailable`. A response that fits no row of `C4.md` §4.3 fails the
  submission with `C4Defect`, and is never retried.

Because the profile's codecs use `scale-ts`, a React Native app installs a
`TextDecoder` before importing this package, as it does for `profile-v0`.

## Tests and the `C4` vectors

The `C4` test vectors are vendored in [`test/c4/`](test/c4/) from a pinned
`ticketto-offchain` commit, recorded with the file's SHA-256 in
[`test/c4/source.json`](test/c4/source.json). The tests check that digest; they
never read another repository.

```sh
pnpm --filter @ticketto/binding-offchain vectors:vendor <40-character commit>   # re-pin
pnpm --filter @ticketto/binding-offchain vectors:check                          # compare with the recorded commit
```

Both need read access to `ticketto-offchain`.

The suites in `test/suites/` are portable. They run under Vitest on Node
(`pnpm test`) and under the Hermes VM, from bytecode compiled by the `hermesc`
React Native ships (`test/hermes/run.ts`, as in `profile-v0`):

```sh
pnpm build
HERMES_VM=/path/to/hermes pnpm --filter @ticketto/binding-offchain test:hermes
```

`packages/profile-v0/test/hermes/build-vm.sh <dir>` builds a matching VM.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
