# The Ticketto V0 published log — format `C7`

This document specifies the byte formats of the Ticketto V0 log and its
checkpoints, and how a party that did not produce the log verifies it
(`REQ-SDK-5`, `REQ-TM-3`). It is written to be implemented from alone: the test
vectors in [`vectors/v0.json`](vectors/v0.json) are reproduced by an independent
decoder written only from this text (`test/independent/decoder.ts`, which
imports nothing from this package).

It is the contract `C7` of `PLAN.md`, owned by `F-006`
(`features/006-log-and-export/plan.md` in `kippurocks/kippu-docs`). The
key words MUST, MUST NOT and MAY are to be read as in RFC 2119.

What the log provides is **tamper evidence**, under a backend that attests
rather than enforces: a party holding a record or a checkpoint can detect a
later rewrite of that history. It does not stop the log's author from writing a
false record in the first place; it makes a rewrite of what was already
published detectable without the author's cooperation.

## 1. Conventions

- Byte strings in this document and in the vectors are lower-case hexadecimal.
- `‖` is concatenation.
- **BLAKE2b-256** is BLAKE2b (RFC 7693) with a 32-byte output, no key.
- Encoding is SCALE, restricted to the forms below. Decoding MUST be strict:
  only the canonical encoding of a value is accepted, and a decoder MUST refuse
  anything else — in particular trailing bytes after a top-level value.

| Form | Encoding |
|---|---|
| `u8` | 1 byte |
| `u64` | 8 bytes, little-endian, unsigned |
| `[u8; n]` | exactly `n` bytes |
| `Compact` | SCALE compact integer: for `v < 2^6`, one byte `v << 2`; for `v < 2^14`, two bytes little-endian `(v << 2) | 1`; for `v < 2^30`, four bytes little-endian `(v << 2) | 2`; otherwise one byte `((k − 4) << 2) | 3` followed by `v` in `k` bytes little-endian, `k` minimal. A value encoded in a longer form than it needs is **not** canonical |
| `Vec<u8>` | `Compact` length, then that many bytes |
| `Option<T>` | `0x00` for none; `0x01` followed by `T`. Any other tag is refused |

Timestamps are `u64` milliseconds since the Unix epoch.

## 2. Records

### 2.1 Layout

```
LogRecord = version       u8          = 0
            sequence      u64
            event         Option<(id [u8;32], eventSequence u64)>
            recordedAt    u64
            input         SignedInput
            presentedAt   Option<u64>
            prevHash      [u8;32]
```

With an event, the fields sit at fixed offsets up to the input: `version` at 0,
`sequence` at 1, the option tag at 9, `id` at 10, `eventSequence` at 42,
`recordedAt` at 50, and `input` from 58. Without an event, `recordedAt` is at 10
and `input` starts at 18.

| Field | Meaning |
|---|---|
| `version` | Record format version. This document specifies version `0`; a decoder MUST refuse any other |
| `sequence` | The record's position in the deployment's single total order (`INV-15`), counting from `0` |
| `event` | The event the input concerns, and the record's position in that event's own order, counting from `0` for the event's first record (`REQ-MG-4`). None for an input that belongs to no event |
| `recordedAt` | When the ledger recorded the input, by its clock |
| `input` | The write as submitted, with its authorisation (§2.2) |
| `presentedAt` | When an access pass was presented at the gate, as its submitter claimed. A claim, not a time the ledger observed |
| `prevHash` | The hash (§2.3) of the record at `sequence − 1`; for the record at sequence `0`, 32 zero bytes |

A record MUST also satisfy, and a decoder MUST refuse a record that does not:

- A **signed command** whose command names an event carries that event as
  `event.id`; a signed command that names no event (`registerCredential`)
  carries no `event`. A **signed access pass** carries an `event` — the event of
  its ticket.
- A signed command carries no `presentedAt`.

There is **no `effects` field**. An accepted input, its place in the order,
`recordedAt` and `presentedAt` determine the change it made under a given rules
version, so a separate summary would be redundant. If effects are ever carried,
they arrive in a new record version. The event reference is optional because
some inputs belong to no event. (Rulings on `F-006`'s plan, §5.1.)

### 2.2 Signed input

`input` is the cryptographic profile's canonical framing of a signed input
(`C2`, `@ticketto/profile-v0`), carried in the record exactly as the profile
produces it:

```
SignedInput = version        u8        = 0
              kind           u8        0 = signed command, 1 = signed access pass
              payload        Vec<u8>
              authorisation  Vec<u8>
```

A decoder MUST refuse a `version` other than `0` or a `kind` other than `0` or
`1`. `payload` is the canonical encoding of the command or the access pass, and
`authorisation` is the profile's authorisation bytes; both are specified by
`C2` (the profile's README and its vectors, `@ticketto/profile-v0/vectors/v0.json`),
and a full verifier decodes and checks them there. What the signer signed is
not `payload` itself but its **signing payload**, `"ticketto/v0/command" ‖
payload` for a command and `"ticketto/v0/pass" ‖ payload` for a pass.

Records carry the signed input, not only its effect, so that a third party can
re-verify that every change was authorised by the right credential rather than
trust the log's author about who did what. The authorisations hold public keys
and WebAuthn client data; none of it is personal data (`NFR-6`), and the
producer refuses any input field outside a reviewed allow-list.

### 2.3 Hash

```
hash = BLAKE2b-256("ticketto/v0/log" ‖ LogRecord)
```

over the ASCII bytes of the tag followed by the record's complete encoding,
`prevHash` included.

## 3. The chain

A log is the sequence of its records' encodings, in order. It is valid when, for
each record in turn:

1. its bytes decode as a record (§2) — otherwise fault **`malformed`**;
2. its `sequence` is the position it is expected at: `0` for the first record,
   one more than its predecessor's otherwise — otherwise **`sequence`**;
3. its `prevHash` equals its predecessor's hash, or 32 zero bytes for the first
   record — otherwise **`link`**;
4. if it has an `event`, its `eventSequence` is `0` for that event's first record
   and one more than that event's previous record's otherwise — otherwise
   **`eventSequence`**.

A verifier reports the **first** record that fails, by the sequence it was
expected at, with the first fault in the order above. So a record removed or
moved shows as `sequence` at the position it left; a record changed in place
shows as `link` at its successor, whose `prevHash` committed to the original.

A verifier MAY start from a known point mid-log: the sequence the next record
takes and the hash of the record before it. Starting there, an event it has not
seen before takes its first `eventSequence` as its baseline.

A log changed in place and then re-linked from that point on — every later
`prevHash` recomputed — passes all four checks. Only a checkpoint (§4) held from
before the rewrite detects it.

## 4. Checkpoints

### 4.1 Layout

```
Checkpoint     = version        u8        = 0
                 sequence       u64
                 headHash       [u8;32]
                 issuedAt       u64
                 authorisation  Vec<u8>

SigningPayload = "ticketto/v0/checkpoint" ‖ version ‖ sequence ‖ headHash ‖ issuedAt
```

A checkpoint states that the record at `sequence` has hash `headHash`. The
signing payload is the ASCII tag followed by the checkpoint's encoding up to,
and not including, `authorisation` (49 bytes). A decoder MUST refuse a
`version` other than `0`.

### 4.2 Signature

A checkpoint is signed by the deployment's **publication key**, a credential of
the profile's `p256` kind (`C2`). The verifier is given the publication key's
registration, published by the deployment. Both are `version ‖ kind ‖ body`:

```
Registration  = 0x00, 0x01, publicKey [u8;33], signature [u8;64]
Authorisation = 0x00, 0x01, publicKey [u8;33], signature [u8;64]
```

`publicKey` is a compressed SEC1 P-256 point; `signature` is ECDSA P-256 `r ‖ s`,
each 32 bytes big-endian, with `s` at most half the group order ("low S"); the
signed digest is used as the message hash directly. A checkpoint is **valid**
when all of these hold:

1. the registration and the authorisation are exactly 99 bytes, start
   `0x00 0x01`, and carry the same `publicKey`, which is a point on the curve;
2. the registration's signature verifies over
   `BLAKE2b-256("ticketto/v0/registration/p256" ‖ publicKey)`;
3. the authorisation's signature verifies over `BLAKE2b-256(SigningPayload)`.

A credential of any other kind — kind `0`, `pass-webauthn` — MUST NOT be
accepted as a checkpoint's signer.

### 4.3 Checking a log against held checkpoints

A party keeps the checkpoints it has seen and verified. When it verifies a log
(§3), for every record it accepts it also compares that record's hash with every
held checkpoint at the same sequence; a difference is fault **`checkpoint`** at
that sequence. If the log ends before a record some held checkpoint covers, the
fault is **`truncated`**, at the sequence the next record would take. A verifier
starting mid-log also compares its starting hash with any checkpoint at the
sequence before its start; checkpoints earlier than that are outside the
stretch it verifies.

So a rewrite at or before a held checkpoint — however carefully re-linked —
is reported at the checkpoint's sequence. Publishing checkpoints where the log's
author cannot quietly replace them is the deployment's obligation (`AD-16`),
not part of this format.

## 5. Export

An export carries a deployment's complete ledger state from one backend to
another (`REQ-MG-3`): every record up to a checkpoint, that checkpoint, and a
snapshot of state at it. Import does not re-execute history; the receiving
backend appends the records verbatim — at the same sequences, with the same
hashes — loads the snapshot, and its observable state is then verified against
the export (§5.4). Nothing derivable from other parts is carried, and no
backend-specific value is: a backend recomputes its own bookkeeping from the
snapshot, and renders its own cursors from sequences.

### 5.1 Stream

```
Export = magic "ticketto/v0/export" (18 ASCII bytes), version u8 = 0, Item*
Item   = tag u8, body Vec<u8>
```

A decoder MUST refuse any other magic or version. The export is the
concatenation of the stream's chunks: chunk boundaries carry no meaning.

| Tag | Item | Body |
|---|---|---|
| `1` | record | a `LogRecord` (§2) |
| `2` | checkpoint | a `Checkpoint` (§4) |
| `3` | event | `Event` (§5.2) |
| `4` | ticket | `Ticket` (§5.2) |
| `5` | credential | `registration Vec<u8>` |
| `6` | cancellation holder | `ticket [u8;32], holder [u8;32]` |
| `7` | consumed pass | `ticket [u8;32], pass [u8;16], retainUntil u64` |
| `8` | operation | `operationId [u8;16], expiresAt u64, digest [u8;32], sequence u64` |
| `0` | end | eight `Compact` counts: of items with tags `1` to `8`, in tag order |

Items appear in ascending tag order, section by section — any section may be
empty — and exactly one `end` item closes the export, with nothing after it.
A decoder MUST refuse an item with an unknown tag, an item out of order, a body
that is not the canonical encoding of its item or has trailing bytes, an `end`
whose counts differ from the items read, and a stream that ends before `end` or
inside an item.

### 5.2 Snapshot items

Identifiers are their `C2` bytes (`@ticketto/profile-v0`); enumerations,
`ClassId`, `Zone`, `Placement`, `AttendancePolicy` and `TicketRestrictions` are
their `C2` encodings.

```
Event  = id [u8;32], owner [u8;32], status u8 (Active 0, Sealed 1, Cancelled 2, Finished 3),
         maxCapacity Option<Compact>, issued Compact, zones Compact count ‖ Zone*
Ticket = id [u8;32], event [u8;32], holder [u8;32], class ClassId,
         provenance u8 (Purchased 0, Granted 1), zone [u8;32], placement Placement,
         policy AttendancePolicy, restrictions TicketRestrictions, attendances Compact
```

- A **credential** carries its registration only; its account and credential id
  are the ones the profile derives from it (`C2`).
- A **cancellation holder** is carried for every ticket of a `Cancelled` event,
  and for no other ticket: the holder that event's cancellation fixed.
- A **consumed pass** is carried while it is within its retention; an
  **operation** while it is within its expiry. `sequence` is that of the record
  the operation produced, which is a signed command or a signed access pass. A
  pass's operation id is its pass id, and its `expiresAt` is the end of its
  retention. `digest` is the operation digest of that record's input, over the
  signed-input framing exactly as the record carries it (§2.2):

  ```
  command  digest = BLAKE2b-256(framing)
  pass     digest = BLAKE2b-256(framing ‖ presentedAt u64)
  ```

  where `presentedAt` is the pass record's own. The same pass presented at
  another time therefore has another digest. An importer carries pass operations
  as it carries command operations, and never rebuilds either.

### 5.3 Consistency

A decoder MUST also refuse an export whose parts disagree:

1. The records form a chain from sequence `0` (§3). There is a checkpoint
   exactly when there is at least one record, and it is at the last record,
   with that record's hash. A reader given the publication key's registration
   also requires the checkpoint to be valid under it (§4.2).
2. Events and tickets are in strictly ascending order of id; cancellation
   holders of ticket; consumed passes of ticket, then pass; operations of
   operation id. Credentials are in ascending order of account — within one
   account, in registration order — and no account carries the same credential
   twice. Every credential's registration derives an account.
3. Every ticket's event, and every consumed pass's ticket, is in the snapshot.
   Cancellation holders are carried for exactly the tickets of `Cancelled`
   events.
4. Every operation's `sequence` names a record whose input's operation digest
   (§5.2) is its `digest`. That input is a signed command whose operation id and
   expiry are the operation's, or a signed access pass whose pass id is the
   operation id and whose record carries a `presentedAt`. A pass operation's
   expiry is not checked against its record, which does not carry the retention
   it ends with.

An encoder sorts each section, so equal state always exports to equal bytes.

### 5.4 Verifying an import

After a backend imports an export, a verifier checks, through the SDK's backend
port alone, and reports the first disagreement:

1. **`log`** — the log read from the start, each record re-linked as §2–§3 lay
   it out, is exactly the exported records, and no more;
2. **`head`** — it ends at the checkpoint's `headHash` (or is empty when there is
   no checkpoint);
3. **`event`**, **`ticket`** — `getEvent` and `getTicket` answer every snapshot
   event and ticket with an equal encoding (§5.2);
4. **`credential`** — `getCredential` answers every credential's account and id
   with its registration;
5. **`cancellationHolder`** — `getCancellationHolder` answers every ticket of a
   `Cancelled` event with its carried holder.

Consumed passes and operations cannot be observed through queries; a backend's
own tests probe them by resubmission.

## 6. Test vectors

[`vectors/v0.json`](vectors/v0.json), generated by `pnpm --filter @ticketto/log
vectors:generate`:

| Key | Holds |
|---|---|
| `publicationRegistration` | The publication key's `p256` registration |
| `records[]` | A sample log: every record's fields (§2.1, with its input's `version`, `kind`, `payload`, `authorisation` and the `framed` input bytes), its `bytes`, and its `hash` |
| `head` | The sample log's next sequence, last hash, and each event's next `eventSequence` |
| `checkpoint` | A valid checkpoint at sequence 5 of the sample log: its fields, `signingPayload` and `bytes` |
| `invalidCheckpoints[]` | Checkpoint bytes that MUST NOT verify against `publicationRegistration` |
| `chains[]` | Logs — `records`, as record bytes — with the `checkpoints` held (`sequence`, `headHash`) and the `expected` result: `{ ok: true }`, or the first failure's `sequence` and `fault` |
| `operationDigests[]` | For a command record and an access-pass record of the sample log, by index in `records[]`: the operation `digest` (§5.2) |
| `malformedRecords[]` | Bytes a decoder MUST refuse |

An implementation conforms when it decodes every record to the stated fields
and hash, reproduces every `chains[]` result, accepts `checkpoint`, refuses every
`invalidCheckpoints[]` entry, reproduces every `operationDigests[]` digest, and
refuses every `malformedRecords[]` entry.
After `M0`, changing a vector is a format revision and needs the feature plan
updated.
