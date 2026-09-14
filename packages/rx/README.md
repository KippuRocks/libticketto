# @ticketto/rx

Optional RxJS adapter: SDK write completion and log hints as Observables, so the SDK itself never depends on RxJS.

Optional adapter (`AD-14`). Owned by `F-002` (`features/002-sdk/plan.md` §5.10).

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes), browser |
| May depend on | `sdk`; RxJS as a peer dependency. Must never depend on a backend or `ledger-rules`. |

## Use

```ts
import { fromHints, fromSubmission } from "@ticketto/rx";

fromSubmission(ticketto.setEventStatus(signer, { event, status: "Sealed" })).subscribe((step) => {
  // { state: "submitted" }, then { state: "settled" } or { state: "rejected" }
});

fromHints(ticketto.log).subscribe((cursor) => {
  // A hint carries a cursor only: pull from the log with ticketto.log.read.
});
```

- `fromSubmission(submission)` emits the same states, in the same order, as
  iterating the `Submission`, and ends as awaiting it does. A `rejected` outcome
  of §10 is a value — emitted, then completion — just as awaiting yields
  `{ ok: false }`. Only a failure outside §10 errors the Observable, with the
  reason awaiting rejects with. A subscriber that arrives late, even after
  completion, still sees every state, so a 1 ms and a 60 s backend look the same
  (`NFR-9`).
- `fromHints(log)` opens its own `hints()` stream per subscription and closes it
  on unsubscribe. A hint is never data: a lost one costs latency, never records
  (`AD-17`).

Neither adapter keeps state of its own; both read through the SDK's async
iterators.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
