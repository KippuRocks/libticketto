---
"@ticketto/ledger-rules": minor
"@ticketto/sdk": patch
---

Maximum operation lifetime (T-008-16). The envelope check rejects a command whose expiry lies more than the configured maximum ahead of the authority's clock with `ERR-OperationExpired`; one exactly at the maximum is accepted. The maximum is rules configuration — `configureExecute({ maxOperationLifetime })` — defaulting to 24 hours (`DEFAULT_MAX_OPERATION_LIFETIME`). The SDK re-vendors `SPEC.md` at kippu-docs `7868b1e`, where `ERR-OperationExpired`'s description is widened to match.
