---
"@ticketto/binding-offchain": minor
"@ticketto/conformance": minor
---

`connectTestOffchainBackend` reads the service's test-mode config (`GET /v0/testing/config`, `C4.md` A.3) when connecting, and its test controls expose `maxRecordingLag` and `maxClockSkew` as the service's rules are configured. With every backend now providing them, `TestControls.maxRecordingLag` and `TestControls.maxClockSkew` are required in `@ticketto/conformance`. The `C4` document and vectors are re-vendored at `ticketto-offchain` `24c10e3`.
