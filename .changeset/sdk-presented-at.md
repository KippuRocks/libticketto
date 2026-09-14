---
"@ticketto/sdk": minor
---

Access-pass submissions carry the time the pass was presented: `submitAccessPass(pass, { presentedAt })`, and `Backend.submit` takes a `SubmitInput` — `{ kind: "command", signed }` or `{ kind: "pass", signed, presentedAt }` — so only a pass carries `presentedAt`. `LogRecord` gains `presentedAt: Timestamp | null`, set for access-pass entries and `null` for commands. The vendored spec moves to amendment 0003 at `50ddee2`, generating `ERR-OperationConflict` (ledger) and `ERR-SponsorshipRefused` (binding) (T-002-05).
