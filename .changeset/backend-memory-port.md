---
"@ticketto/backend-memory": minor
---

`createMemoryBackend`: the C8 port over `@ticketto/ledger-rules`, in process — `submit` reports `submitted` synchronously and settles on a later microtask; `query` answers through the rules (T-005-02, REQ-SDK-1, NFR-9).
