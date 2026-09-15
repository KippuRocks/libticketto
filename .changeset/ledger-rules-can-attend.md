---
"@ticketto/ledger-rules": minor
---

`canAttend` and `getCancellationHolder` queries (T-008-09). `canAttend` answers a verdict with its reason, in `REQ-Q-2`'s order — `ERR-EventCancelled`, `ERR-EventFinished`, `ERR-PolicyUndeterminable`, `ERR-TicketExpired` (policy expiry at the authority's clock), `ERR-CannotAttend` — and writes nothing. `getCancellationHolder` answers the holder fixed at cancellation — the lazy snapshot, else the holder — or `null` while the event is not `Cancelled`.
