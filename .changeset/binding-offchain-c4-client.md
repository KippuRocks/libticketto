---
"@ticketto/binding-offchain": minor
---

A `fetch`-based client for `C4`, the wire protocol to `ticketto-offchain`: `createC4Client({ url, fetch? })` with one method per endpoint, pure request builders that refuse malformed requests, and a classification of every response into the rows of `C4.md` §4.3. The `C4` vectors, vendored from `ticketto-offchain` at `6977fe0`, are reproduced on Node and under Hermes (T-007-01).
