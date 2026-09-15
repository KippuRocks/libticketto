# @ticketto/ledger-rules

The ledger's rules — commands, invariants and errors — implemented once over the capability interfaces, and run by whatever holds authoritative ledger state.

Contract `C3`. Owned by `F-008`.

**Status:** the `C3` capability interfaces are declared (`T-008-01`); `execute`
runs the checks every signed command passes (`T-008-02`, `T-008-13`).

| Command | Handler |
|---|---|
| `createEvent` | Implemented (`T-008-03`) |
| `addZone`, `removeZone` | Implemented (`T-008-06`) |
| `issueTicket` | Implemented (`T-008-07`) |
| `registerCredential` | Implemented (`T-008-14`) |
| Queries: `getEvent`, `getTicket`, `getCredential`, `canAttend`, `getCancellationHolder` | Implemented (`T-008-02`, `T-008-15`, `T-008-09`) |
| `submitAccessPass` | Implemented (`T-008-10`) |
| Every other command | Not yet — each throws until its task lands |

| | |
|---|---|
| Runs on | Node 24, React Native (Hermes) |
| May depend on | `sdk` (types) and `profile-v0` (the operation digest). Must never depend on a backend, nor perform I/O. |

## Executing an input

```ts
import { execute, query } from "@ticketto/ledger-rules";

const result = await execute(caps, profile, signedCommand); // Result<Receipt>
const event = await query(caps, profile, { kind: "getEvent", event: id });
```

`execute` runs the whole input in one `caps.transaction`. Every signed command
passes, in this order (plan §5.2):

0. The event and ticket it names exist → `ERR-EventNotFound` /
   `ERR-TicketNotFound`. `createEvent` and `issueTicket` name ones yet to exist.
1. Its envelope has not expired, and its expiry lies no more than the maximum
   operation lifetime ahead of the clock → `ERR-OperationExpired`. The maximum
   defaults to 24 hours (`DEFAULT_MAX_OPERATION_LIFETIME`); an authority sets
   its own with `configureExecute({ maxOperationLifetime })`.
2. Its operation id is not recorded. An identical replay — same id, same digest
   of the profile's signed-input framing — returns the original receipt and
   changes nothing; the same id with a different input is
   `ERR-OperationConflict` (`REQ-CM-1`).
3. Its authorisation verifies, over `profile.encodeCommand(command)`, against a
   credential registered to the account it claims → `ERR-InvalidAuthorisation`
   (`REQ-CP-6`). An account's first `registerCredential` is the one
   exception: the credential being registered authorises it.
4. The event it names is not `Finished` → `ERR-EventFinished` (`INV-16`).
5. The command's own checks.

An accepted command's writes, its log record (carrying the signed input) and its
operation record commit together. A rejected command writes nothing. A defect —
something no rule can judge — throws, and the transaction rolls back.

## Submitting an access pass

```ts
const result = await execute(caps, profile, signedPass, { presentedAt });
```

A pass carries its holder's authorisation; its pass id is its operation id, and
`presentedAt` is the submitter's claim, which the rules bound (plan §5.2):

0. The ticket exists → `ERR-TicketNotFound`. An identical resubmission — the same
   signed pass and the same `presentedAt` — of a consumed pass returns the
   original receipt, up to `notAfter` plus the maximum recording lag; an operation
   record under the pass id that is not this pass's is `ERR-OperationConflict`.
1. The authorisation verifies, and its signer is the ticket's current holder →
   `ERR-InvalidPass`.
2. The window is no longer than the maximum pass window, `presentedAt` lies within `[notBefore, notAfter]` and no more than the maximum
   clock skew ahead of the clock, and the clock is no later than `notAfter` plus
   the maximum recording lag → `ERR-PassExpired`.
3. The pass id is not consumed for the ticket → `ERR-PassReplayed`.
4. `canAttend`'s order, with policy expiry judged at `presentedAt`.
5. `attendances` goes up by one; the pass id is kept until `notAfter` plus the
   maximum recording lag.

| Configuration (`configureExecute`) | Default |
|---|---|
| `maxOperationLifetime` | 24 hours (`DEFAULT_MAX_OPERATION_LIFETIME`) |
| `maxRecordingLag` | 5 minutes (`DEFAULT_MAX_RECORDING_LAG`) |
| `maxClockSkew` | 10 seconds (`DEFAULT_MAX_CLOCK_SKEW`) |
| `maxPassWindow` | 5 minutes (`DEFAULT_MAX_PASS_WINDOW`) |

## Capabilities (`C3`)

A store supplies the rules with `Capabilities` (`REQ-SDK-3`):

| | |
|---|---|
| `registry` | Ledger state in domain terms: events (as `EventRecord`, with the zones in which a ticket has been issued), credential registrations by account, tickets and their facts, consumed pass ids with retention, operation ids with expiry and a digest of the signed input, and appending logical log records (with a pass's claimed `presentedAt`) |
| `clock` | A monotonic current timestamp |
| `value` | Declared for settlement beyond V0; nothing implements it in V0 |
| `transaction(fn)` | Runs `fn` in one serialisable transaction: its writes commit together when `fn` resolves, and none does when it rejects |

`backend-memory` (`F-005`) and `ticketto-offchain` (`F-010`) implement them. The
package's own unit tests run against the fakes in `test/fake-capabilities.ts`,
which are not exported.

Part of [libticketto](../../README.md). Behaviour is specified in `SPEC.md` and
the package's design in `PLAN.md` and `features/`, in
[`kippurocks/kippu-docs`](https://github.com/KippuRocks/kippu-docs).
