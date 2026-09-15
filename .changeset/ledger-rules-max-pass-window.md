---
"@ticketto/ledger-rules": minor
---

Maximum pass window (T-008-17): `configureExecute({ maxPassWindow })`, default 5 minutes (`DEFAULT_MAX_PASS_WINDOW`). A pass whose `notAfter − notBefore` exceeds it is `ERR-PassExpired`; one exactly at the maximum is accepted (`REQ-AP-3`).
