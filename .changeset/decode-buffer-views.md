---
"@ticketto/log": patch
"@ticketto/profile-v0": patch
---

Decoders read a byte view from its own offset: records, checkpoints and exports (`@ticketto/log`), and every C2 decoder (`@ticketto/profile-v0`), now decode a Node `Buffer` sliced out of a larger pool correctly, where they previously misread integers and lengths (follow-up to T-006-01).
