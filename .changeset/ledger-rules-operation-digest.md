---
"@ticketto/ledger-rules": minor
---

`C3`: `OperationRecord` carries `digest: Uint8Array` — a digest of the signed input, computed by the rules and only stored by the capabilities — so an identical replay can be told from `ERR-OperationConflict` (`REQ-CM-1`). `LogAppend` gains `presentedAt: Timestamp | null`, so a store can put a pass's claimed presentation time in its record (T-008-01).
