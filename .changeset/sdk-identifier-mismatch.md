---
"@ticketto/sdk": minor
---

Re-vendor `SPEC.md` at kippu-docs `f5d8e69` (amendment 0003): `TickettoErrorCode` gains `ERR-IdentifierMismatch`, a ledger error for a command whose stated `EventId` or `TicketId` is not the profile's canonical representation of its components; `ERR-ZoneExists` also covers an event created with the same zone id twice.
