---
"@ticketto/ledger-rules": minor
---

`transferTicket` (T-008-08): the signer must hold the ticket (`ERR-NotOwner`) and it must not be `cannotTransfer` (`ERR-CannotTransfer`); a `Sealed` or `Cancelled` event's ticket still transfers. On a cancelled event's ticket's first change of hands, the holder before it is recorded as the cancellation holder, and never changes afterwards (`REQ-EV-10`).
