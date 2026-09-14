---
"@ticketto/binding-offchain": minor
---

`createRetrier`: one retry budget for every `C4` exchange — transport failures, timeouts, `503`, non-C4 `5xx` and resubmissions spend it, progress refills it, and a spent budget reports `LEDGER_UNAVAILABLE` (`ERR-LedgerUnavailable`, no detail). `createOffchainSubmit` uses it, and `retrier.read` provides the same for reads (T-007-07).
