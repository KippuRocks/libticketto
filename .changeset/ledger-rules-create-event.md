---
"@ticketto/ledger-rules": minor
---

`createEvent` (T-008-03): the event id must be the profile's derivation from the signer and salt (`ERR-IdentifierMismatch`), must not exist (`ERR-EventIdExists`), and its zone ids must be unique (`ERR-ZoneExists`); the event is recorded `Active`, owned by the signer, with nothing issued and the capacity given — `null` for unbounded issuance.
