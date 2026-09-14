---
"@ticketto/binding-offchain": minor
---

`WIRE_TRANSLATION`: the error translation table of `C4.md` §4.2–§4.3 — for every wire code, its statuses, the endpoints that may send it, and its row — now the only input to response classification, with `translateWireCode`, `codesRaisedByBinding` and `UNAVAILABLE_CODE`. `C4.md` is vendored beside the vectors at `ticketto-offchain` `3711af6`, and the suites fail on any wire code it or the vectors carry that the table does not map (T-007-04).
