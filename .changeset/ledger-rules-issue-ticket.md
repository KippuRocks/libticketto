---
"@ticketto/ledger-rules": minor
---

`issueTicket` (T-008-07), with plan §5.2's checks in order: owner, `Active`, zone known, placement kind, derived `TicketId` (`ERR-IdentifierMismatch`), `ERR-TicketIdExists`, `ERR-CapacityExceeded`, `ERR-RestrictionNotPermitted`. `cannotTransfer` implies `cannotResale`; the event's `issued` count and `zonesInUse` are updated in the same transaction.
