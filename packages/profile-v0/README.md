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

| `pass-webauthn` | |
|---|---|
| Registration | hashed user id (32) ‖ `Attestation` |
| Authorisation | device id (32) ‖ `Assertion` |
| Credential id | the device id, as hex |

`Attestation` and `Assertion` are byte for byte the SCALE structures of
[`virto-network/papi-signers`](https://github.com/virto-network/papi-signers),
with `authority_id` `"kreivo_p"` and `context` `0`. An assertion over a payload
verifies when its user id is the registration's, its device is the registered
one, its client data is a `webauthn.get` whose challenge is
`base64url(BLAKE2b-256(payload))`, its authenticator data carries the configured
RP id hash and the user-verified flag, and its ECDSA P-256 signature over
`authenticatorData ‖ SHA-256(clientDataJSON)` verifies after DER is normalised
to low S. The RP id is deployment configuration: changing it invalidates every
holder passkey.

The profile does not interpret an attestation's challenge: a registration is
accepted for an account only through a command authorised under `REQ-CP-6`.

`p256` signatures are `r ‖ s` with low S; `normaliseP256Signature` turns a DER signature
(as a KMS returns) into that form. A high-S signature is refused.

## Access passes

```
AccessPass       = version u8, ticket [u8;32], holder [u8;32], passId [u8;16],
                   notBefore u64, notAfter u64                  (97 bytes)
SignedAccessPass = pass, authorisation (length-prefixed bytes)
```

`producePass` is a pure function plus a `Signer`, with no network (`NFR-3`); the
window defaults to 60 s (`NFR-5`). `verifyPass` checks that the authorisation
comes from the pass's holder account through the given registration, that the
signature verifies, and that the supplied clock is inside `[notBefore, notAfter]`:
`ERR-InvalidPass` or `ERR-PassExpired` otherwise. Whether the holder still holds
the ticket, and whether the pass was already consumed, are the ledger rules'.

## Runtime requirements

`scale-ts` constructs a `TextDecoder` when it is imported. Hermes does not
provide one, so a React Native app must install a `TextDecoder` polyfill before
importing this package, as apps using `polkadot-api` already do. `producePass`'s
default pass id uses `crypto.getRandomValues`, which React Native apps provide
through a native module such as `react-native-get-random-values`.

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
