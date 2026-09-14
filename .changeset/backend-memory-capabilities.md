---
"@ticketto/backend-memory": minor
---

In-memory C3 capabilities: `createMemoryCapabilities` supplies the ledger rules with a registry, a clock and serialisable transactions — one global mutex and a copy-on-write layer committed only when the transaction's function resolves (T-005-01, REQ-MG-1, INV-6).
