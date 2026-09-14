# @ticketto/log

The published log: record and checkpoint format, hash chain, export and import.

Contract `C7`. Owned by `F-006`.

**Status:** being built by `F-006` for `M0`. The record codec, its hash, the
`NFR-6` allow-list, the chain builder and checkpoints are in place; the format
document and test vectors follow.

| | |
|---|---|
| Runs on | Node 24; no Node.js built-ins, so anywhere Node runs |
| Depends on | `sdk` (types), `profile-v0` (canonical command and pass bytes, BLAKE2b) |

## Record

```
LogRecord = version u8, sequence u64,
            event Option<(id [u8;32], eventSequence u64)>,
            recordedAt u64, input SignedInput, presentedAt Option<u64>,
            prevHash [u8;32]
hash      = BLAKE2b-256("ticketto/v0/log" ‖ LogRecord)
```

SCALE (`AD-11`), integers little-endian. `input` is the profile's signed-input
framing (`encodeSignedCommand`, `encodeSignedAccessPass`: version, kind, payload,
authorisation), carried as it is, so a third party re-verifies each
authorisation against the record itself. Decoding is strict: only the canonical
encoding of a record is accepted.

- **No `effects` field in V0.** The input, its place in the order, `recordedAt`
  and `presentedAt` determine the change under a rules version. Should effects
  ever be needed, they come as a new record version.
- **The event reference is optional**, as in the SDK's `LogRecord`: registering
  a credential belongs to no event. A command's record names the command's own
  event; a pass's record names the event of its ticket. Only a pass's record
  carries a `presentedAt`.
- **`NFR-6` allow-list.** `encodeRecord` refuses, with `LogContentError`, any
  field of a record or its input that the allow-list does not name — per
  command kind, and for every nested value — rather than letting the encoding
  drop it silently.

## Chain

One total `sequence` per deployment, from 0 (`INV-15`), and one `eventSequence`
per event, from 0 for its first record (`REQ-MG-4`). The first record's
`prevHash` is 32 zero bytes (`GENESIS_HASH`).

- `linkRecord(head, entry, eventSequence)` is pure: a store keeps the head and
  each event's next sequence in its own transaction, and commits the linked
  record's bytes. Its entry is the rules' `LogAppend`, field for field.
- `LogChain` keeps both in memory, and resumes from a saved `state()`.
- `verifyChain(records, from?)` recomputes every hash and checks both orders,
  reporting the first record it rejects: a removed or reordered record at the
  position it left (`sequence`), a changed record at its successor (`link`).
  It does not check authorisations.

## Checkpoints

```
Checkpoint      = version u8, sequence u64, headHash [u8;32], issuedAt u64,
                  authorisation Vec<u8>
signing payload = "ticketto/v0/checkpoint" ‖ version ‖ sequence ‖ headHash ‖ issuedAt
```

A checkpoint states that the record at `sequence` has hash `headHash`.
`signCheckpoint` signs it through a `Signer` holding the publication key;
`verifyCheckpoint` accepts it only when both the key's registration and the
authorisation are of the profile's `p256` kind and the signature verifies.

`verifyChain(records, from, checkpoints)` checks the log against checkpoints a
party already holds (`REQ-TM-3`). A log rewritten and re-linked consistently
passes every other check; against a held checkpoint it fails at the
checkpoint's sequence (`checkpoint`), or where the log ends if it was cut short
before it (`truncated`). Publishing checkpoints is `ticketto-offchain`'s.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
