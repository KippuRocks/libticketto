---
"@ticketto/ledger-rules": minor
---

`execute` and `query` (T-008-02). `execute` runs a signed command through the checks every command passes — envelope expiry, replay by operation id and digest (an identical replay returns the original receipt; a different command under the same id is `ERR-OperationConflict`), authorisation against a credential registered to the signing account, and `INV-16` — then its handler, and appends its log record and operation record in the same transaction. Command handlers and access passes follow in later tasks. `query` answers `getEvent` and `getTicket`.
