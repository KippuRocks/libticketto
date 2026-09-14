# @ticketto/binding-offchain

The SDK binding to the hosted `ticketto-offchain` ledger service.

Owned by `F-007`.

**Status:** the `C8` backend port over `C4` — submission, queries, the log reader
with hints, and assurance — with test controls under `/testing`.

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

## The backend

```ts
const connected = await connectOffchainBackend({ url: "https://ledger.example" });
if (connected.ok) createTicketto({ backend: connected.value, profile, sponsor, operationLifetime });
```

`connectOffchainBackend` reads the deployment's assurance declaration once — the
port exposes it as a plain property — and answers `ERR-LedgerUnavailable` when the
service cannot be reached.

- **Queries** (`POST /v0/query`) answer the SDK's `Result` unchanged;
  `getCredential`'s `Registration` arrives as hex and is returned as bytes.
- **The log reader** (`GET /v0/log`) decodes each entry with `@ticketto/profile-v0`'s
  signed-input decoders into `SignedCommand` or `SignedAccessPass`. A limit above
  C4's 1000 is served as a shorter page, which `LogPage` allows.
- **Hints** carry cursors only (`AD-17`). `events` reads the service's server-sent
  stream (Node); `poll` polls `GET /v0/checkpoints/latest`'s head (React Native).
  The default, `auto`, streams, and polls from the first time the platform's
  `fetch` returns no streamed body. A failed transport reconnects with backoff
  for as long as the reader iterates.
- Reads spend a retry budget of their own and answer `ERR-LedgerUnavailable` when
  it is spent; a defect throws `C4Defect`.

## Test controls

`@ticketto/binding-offchain/testing` connects to a service in test mode
(`TICKETTO_TEST_MODE=1`, `C4.md` Appendix A) with `connectTestOffchainBackend`: the
port plus the conformance suite's `TestControls` — a clock over
`/v0/testing/clock` and seeded `randomBytes`. The clock is synchronous, as the
suite expects: `now()` answers at once, and every request the port makes waits
until the clock changes before it have reached the service. A change the service
refuses fails the next request with `TestModeError`. For tests only.

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
  `ERR-LedgerUnavailable` — before or after `submitted`. A response that fits no
  row of `C4.md` §4.3 fails the submission with `C4Defect`, and is never retried.

## Unavailability

`createRetrier({ retry?, timers? })` holds the one retry mechanism every `C4`
exchange uses. Each retry row of `C4.md` §4.3 — a transport failure, a timeout,
`503 unavailable`, a `5xx` without a C4 body — and each resubmission spends one
budget (`DEFAULT_RETRY`: 8 attempts, backoff from 250 ms doubling to 10 s, never
sooner than `Retry-After`). An answer that is not a retry row refills it. When it
is spent, the ledger could not be reached, and the binding reports
`LEDGER_UNAVAILABLE` — `{ code: "ERR-LedgerUnavailable" }`, with no detail
(amendment 0003 G8, `REQ-SDK-2`). `retrier.read` does the same for a
side-effect-free exchange, for the reads of the port.

`ERR-LedgerUnavailable` is retryable: a submission rejected with it may still be
recorded, and resubmitting the same signed input is safe — the service answers
with the first attempt's outcome (`REQ-CM-1`).

Because the profile's codecs use `scale-ts`, a React Native app installs a
`TextDecoder` before importing this package, as it does for `profile-v0`.

## Error translation

`WIRE_TRANSLATION` is `C4.md` §4.2–§4.3 as a table: for every wire code, the
statuses and endpoints it may come with, and its row — a defect, a retry, a
resubmission, or a rejection with a §10 code. The response classifier reads
nothing else, so a wire code without a row is a defect, and the suites fail on
any code the vendored document or vectors carry that the table does not map. The
only §10 codes the binding raises itself are binding-origin:
`ERR-SponsorshipRefused` and `ERR-LedgerUnavailable`. Ledger-origin codes pass
through unchanged; any other §10 code from the service is a defect (`REQ-SDK-2`).

## Tests and the `C4` vectors

`C4.md` and its test vectors are vendored in [`test/c4/`](test/c4/) from a pinned
`ticketto-offchain` commit, recorded with each file's SHA-256 in
[`test/c4/source.json`](test/c4/source.json). The tests check those digests; they
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
