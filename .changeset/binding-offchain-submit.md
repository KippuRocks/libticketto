---
"@ticketto/binding-offchain": minor
---

`createOffchainSubmit({ client })`: `Backend.submit` over `C4`. Signed inputs are framed with `@ticketto/profile-v0`'s encoder (now a runtime dependency), reported `submitted` on the service's `202`, and long-polled to settlement. Transient failures and `operation-unknown` resend the identical request with exponential backoff, honouring `Retry-After`; a spent budget rejects with `ERR-LedgerUnavailable`, and a response outside `C4.md` §4.3 fails with `C4Defect`. The `C4` vectors are re-vendored at `07be155` (T-007-02).
