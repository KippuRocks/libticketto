---
"@ticketto/ledger-rules": minor
---

Not-found checks (T-008-13): every command naming an existing event or ticket, and every query, is refused with `ERR-EventNotFound` or `ERR-TicketNotFound` when it does not exist. Commands check this before any other check.
