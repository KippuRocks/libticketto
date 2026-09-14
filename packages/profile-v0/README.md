# @ticketto/profile-v0

The V0 cryptographic profile: credential verification, identity derivation, access pass format, and canonical encoding.

Contract `C2`. Owned by `F-003`.

**Status:** being built by `F-003` for `M0`. The byte formats are not agreed until
the test vectors land (`T-003-08`).

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes), browser |
| May depend on | `sdk`, for types only. Must never depend on a backend. |

## Encoding

SCALE, through `scale-ts` (`AD-11`). Every top-level value starts with a one-byte
format version (`FORMAT_VERSION`, `0`). Decoding is strict: only the canonical
encoding of a value is accepted, so no two byte strings stand for one signed
value.

| Value | Encoding |
|---|---|
| `EventId`, `TicketId`, `ZoneId`, `AccountId` | 32 bytes |
| Unseated discriminator, `PassId`, `OperationId` | 16 bytes |
| `ClassId`, `ProofId`, seat `Position` | length-prefixed bytes |
| `MetadataLocator` | length-prefixed UTF-8 |
| `Timestamp` | `u64`, milliseconds since the Unix epoch |
| `Count` | compact integer |
| `Option<T>` (`T \| null`) | `0`, or `1` followed by `T` |
| Enumerations | one-byte index, in the order the SDK declares the variants |
| Command | version, `operationId`, `expiresAt`, kind index, body |

## Identifiers

| Identifier | Derivation |
|---|---|
| Holder `AccountId` | `BLAKE2b-256(0³² ‖ SHA-256(userId))`, Kreivo's `kreivoPassDefaultAddressGenerator`; `userId` is 32 random bytes as lower-case hex |
| `p256` `AccountId` | `BLAKE2b-256("ticketto/v0/account/p256" ‖ compressed public key)` |
| WebAuthn `deviceId` | `BLAKE2b-256(credential rawId)` |
| `EventId` | `BLAKE2b-256("ticketto/v0/event" ‖ creator ‖ salt)` |
| `TicketId` | `BLAKE2b-256("ticketto/v0/ticket" ‖ SCALE(eventId, zoneId, placement))` |

## Credentials

`Registration` and `Authorisation` are `version u8 ‖ kind u8 ‖ body`. Kind `0` is
`pass-webauthn` (holders); kind `1` is `p256` (Kippu's server keys).

| `p256` | |
|---|---|
| Registration | compressed public key (33) ‖ signature (64) over `BLAKE2b-256("ticketto/v0/registration/p256" ‖ public key)` |
| Authorisation | compressed public key (33) ‖ signature (64) over `BLAKE2b-256(payload)` |
| Credential id | the compressed public key, as hex |

Signatures are `r ‖ s` with low S; `normaliseP256Signature` turns a DER signature
(as a KMS returns) into that form. A high-S signature is refused.

## Runtime requirements

`scale-ts` constructs a `TextDecoder` when it is imported. Hermes does not
provide one, so a React Native app must install a `TextDecoder` polyfill before
importing this package, as apps using `polkadot-api` already do.

## Tests

Most suites are portable (`test/suites`): Vitest runs them on Node with the rest
of the workspace, and `test/hermes` runs the same suites under the Hermes VM.

```sh
test/hermes/build-vm.sh ~/.cache/hermes-vm     # once: builds the VM matching hermes-compiler
HERMES_VM=~/.cache/hermes-vm/bin/hermes pnpm --filter @ticketto/profile-v0 test:hermes
```

The runner bundles the suites with Metro and React Native's Babel preset,
compiles them with the `hermesc` React Native ships, and executes the bytecode
on a VM built from the same `facebook/hermes` release. CI does the same in the
`Hermes run` job.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
