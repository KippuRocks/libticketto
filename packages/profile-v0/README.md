# @ticketto/profile-v0

The V0 cryptographic profile: credential verification, identity derivation, access pass format, and canonical encoding.

Contract `C2`. Owned by `F-003`.

**Status:** being built by `F-003` for `M0`. The byte formats are not agreed until
the test vectors land (`T-003-08`).

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes), browser |
| May depend on | `sdk`, for types only. Must never depend on a backend. |

## Use

```ts
import { createProfileV0 } from "@ticketto/profile-v0";
import { createTicketto } from "@ticketto/sdk";

const profile = createProfileV0({ rpId: "kippu.rocks" });
const ticketto = createTicketto({ backend, profile, sponsor, operationLifetime: 120_000 });
```

`createProfileV0` implements the SDK's `Profile` (`REQ-CP-2`). Its one
configuration is the WebAuthn RP id holder passkeys are bound to; changing it
invalidates every holder passkey, so it is a profile change and a migration.

## Testing

`@ticketto/profile-v0/testing` exports software credentials for tests and the
conformance suite only, never for production (plan §5.6):

- `softwareP256Signer()` — a `p256` key in memory, with its self-signed registration;
- `simulatedWebAuthnSigner({ rpId })` — a holder's `pass-webauthn` credential on a
  simulated passkey device, whose every signature is a full assertion ceremony
  with real authenticator data, client data JSON and a DER signature;
- `SimulatedWebAuthnAuthenticator` — the device itself, with overrides for
  building invalid ceremonies.

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

`src/credential/papi-signers.compat.test.ts` runs on Node only: it drives
`@virtonetwork/authenticators-webauthn`'s own `WebAuthn` authenticator (with
`@virtonetwork/signer`) against a simulated `navigator.credentials`, and requires
identical account ids, device ids, attestation bytes and assertion bytes.

The runner bundles the suites with Metro and React Native's Babel preset,
compiles them with the `hermesc` React Native ships, and executes the bytecode
on a VM built from the same `facebook/hermes` release. CI does the same in the
`Hermes run` job.

## Benchmarks

`test/bench/pass.bench.ts` measures the presented size, QR version (byte mode,
level M) and verification time of a signed pass, for `pass-webauthn` and, for
comparison, `ed25519` (`NFR-1`, `AD-10`, `AD-23`):

```sh
pnpm --filter @ticketto/profile-v0 bench                       # Node
HERMES_VM=… pnpm --filter @ticketto/profile-v0 bench:hermes    # Hermes
```

CI prints both in the `Hermes run` job. These are Node and Hermes numbers on
development and CI machines only: the reference-device measurement `AD-23`
requires has not been made.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
