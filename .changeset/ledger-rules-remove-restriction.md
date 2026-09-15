---
"@ticketto/ledger-rules": minor
---

`removeRestriction` (T-008-12): the event's owner only (`ERR-NotOwner`); only ever clears a flag (`INV-10`). Clearing `cannotResale` on a ticket that is also `cannotTransfer` clears both (`REQ-TK-2`); clearing `cannotTransfer` clears only it. Clearing a flag already clear is accepted and changes nothing. Every V0 command now has a handler.
