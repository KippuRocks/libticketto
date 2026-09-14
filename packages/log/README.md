# @ticketto/log

The published log: record and checkpoint format, hash chain, export and import.

Contract `C7`. Owned by `F-006`.

**Status:** being built by `F-006` for `M0`. The record codec, its hash and the
`NFR-6` allow-list are in place; the chain builder, checkpoints and the format
document follow.

| | |
|---|---|
| Runs on | Node 24; no Node.js built-ins, so anywhere Node runs |
| Depends on | `sdk` (types), `profile-v0` (canonical command and pass bytes, BLAKE2b) |

## Record

```
LogRecord = version u8, sequence u64,
            event Option<(id [u8;32], eventSequence u64)>,
            recordedAt u64, input Input, presentedAt Option<u64>,
            prevHash [u8;32]
Input     = 0u8, command Vec<u8>, authorisation Vec<u8>     a signed command
          | 1u8, pass [u8;97], authorisation Vec<u8>        a signed access pass
hash      = BLAKE2b-256("ticketto/v0/log" ‖ LogRecord)
```

SCALE (`AD-11`), integers little-endian. `command` and `pass` are the profile's
canonical bytes — exactly what was signed — so a third party re-verifies each
authorisation against the record itself. Decoding is strict: only the canonical
encoding of a record is accepted.

- **No `effects` field in V0.** The input, its place in the order, `recordedAt`
  and `presentedAt` determine the change under a rules version. Should effects
  ever be needed, they come as a new record version.
- **The event reference is optional**, as in the SDK's `LogRecord`: registering
  a credential belongs to no event. A command's record names the command's own
  event; a pass's record names the event of its ticket.
- **`NFR-6` allow-list.** `encodeRecord` refuses, with `LogContentError`, any
  field of a record or its input that the allow-list does not name — per
  command kind, and for every nested value — rather than letting the encoding
  drop it silently.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
