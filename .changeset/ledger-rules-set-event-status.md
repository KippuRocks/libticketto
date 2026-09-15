---
"@ticketto/ledger-rules": minor
---

`setEventStatus` (T-008-04): owner only (`ERR-NotOwner`); the transitions of `REQ-EV-11` — `Active → Sealed`, `Active | Sealed → Finished | Cancelled` — and `ERR-InvalidTransition` for any other, including out of `Cancelled`. A change out of `Finished` is `ERR-EventFinished` (`INV-16`).
