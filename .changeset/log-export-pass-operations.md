---
"@ticketto/log": minor
---

Exports carry access-pass operations: an exported operation's record may be a signed pass, with its C3 digest over the signed-pass framing and `presentedAt` (`operationDigest`). `readExport` accepts them, and the vectors gain `operationDigests` (follow-up to T-006-04).
