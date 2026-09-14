---
"@ticketto/sdk": minor
---

An optional `migration` member on `Backend` (`Migration`: `export()` and `import(stream)`), and a `@ticketto/sdk/migration` entry point with `exportLedger(backend)` and `importLedger(backend, stream)`; failures are a `MigrationResult` with a typed reason (T-002-13).
