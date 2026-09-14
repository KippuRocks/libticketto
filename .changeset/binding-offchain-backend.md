---
"@ticketto/binding-offchain": minor
---

`connectOffchainBackend`: the `C8` port over `C4` — submission, queries (`getCredential` included), the log reader decoding entries with `@ticketto/profile-v0`, hints (server-sent events on Node, polling on React Native), and the assurance declaration. `@ticketto/binding-offchain/testing` adds `connectTestOffchainBackend`, the conformance suite's `TestControls` over a service in test mode. The `C4` document and vectors are re-vendored at `ticketto-offchain` `c5fadb8` (T-007-03).
