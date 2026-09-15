---
"@ticketto/ledger-rules": minor
---

`submitAccessPass` (T-008-10): `execute(caps, profile, signedPass, { presentedAt })` checks the holder (`ERR-InvalidPass`), the window, the maximum clock skew and the maximum recording lag (`ERR-PassExpired`), single use (`ERR-PassReplayed`), then `canAttend`'s order with policy expiry at presentation; it increments `attendances` by one and keeps the pass id until `notAfter` plus the maximum recording lag. An identical resubmission — same pass, same `presentedAt` — returns the original receipt. For a pass, the C3 operation digest covers `presentedAt`. New rules configuration `maxRecordingLag` (default 5 minutes) and `maxClockSkew` (default 10 seconds), with exported defaults.
