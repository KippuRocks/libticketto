---
"@ticketto/ledger-rules": minor
"@ticketto/backend-memory": patch
---

`addZone` and `removeZone` (T-008-06). `C3`: the registry stores and returns an `EventRecord` — the SDK's `Event` plus `zonesInUse`, the zones in which a ticket has been issued — so `removeZone` can refuse with `ERR-ZoneInUse` (plan §5.7a). `backend-memory` stores the record whole.
