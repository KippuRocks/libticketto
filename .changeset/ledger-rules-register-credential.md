---
"@ticketto/ledger-rules": minor
---

`registerCredential` (T-008-14). An account's first registration is authorised by the credential it registers, and creates the account; every further one needs a credential already registered to that account (`REQ-CP-6`). A registration naming another account, or signed for another account, is `ERR-InvalidAuthorisation`. Re-registering a credential already registered is accepted, changes no state, and is logged.
