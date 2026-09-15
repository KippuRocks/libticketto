---
"@ticketto/ledger-rules": minor
---

`setEventCapacity` (T-008-05): owner only, `Active` only (`ERR-EventSealed` / `ERR-EventCancelled`); never below `issued` (`ERR-CapacityBelowIssuance`); an increase, or removing the bound, needs a proof id (`ERR-CapacityProofRequired`), which the log entry records (`INV-11`, `REQ-EV-6`).
