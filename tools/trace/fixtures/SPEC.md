# Fixture spec for ticketto-trace

A reduced SPEC.md with each kind of definition the tool reads.

## 6. User stories

**`US-A1`** — As an organiser, I create an event.
- `AC-A1.1` Given an organiser, Then an event exists.
- `AC-A1.2` Given no capacity, Then issuance is unbounded.

**`US-A2`** — As an organiser, Kippu administers my event.
- `AC-A2.1` Given an event, Then Kippu exercises authority.

**`US-E4`** — *Withdrawn by amendment 0002, with `AC-E4.1`–`AC-E4.3`.*

**`US-E5`** — As an organiser, I authorise staff.
- `AC-E5.1` Authorisation lives in Kippu.
- `AC-E5.2` *Withdrawn by amendment 0002.*

**`REQ-SDK-7`** Every backend MUST pass the suite.

**`REQ-SDK-8`** *Withdrawn by amendment 0002.*

## 9. Invariants

| ID | Invariant |
|---|---|
| `INV-1` | A ticket belongs to exactly one event. |
| `INV-2` | A ticket has exactly one holder. |
| `INV-9` | *Withdrawn by amendment 0002.* |

## 10. Errors

| ID | Condition |
|---|---|
| `ERR-CapacityExceeded` | Issuance beyond capacity |
| `ERR-BalanceLow` | *Renamed `ERR-CannotPay` by amendment 0002.* |
| `ERR-CannotPay` | Buyer cannot pay |

## 11. Non-functional requirements

| ID | Requirement |
|---|---|
| `NFR-8` | The suite exercises every invariant. |

## 15. Traceability

| Epic | Stories | Primary layer | Key invariants |
|---|---|---|---|
| A — Event lifecycle | `US-A1`–`US-A2` | Ticketto | `INV-1` |

### Release scope

| Epic | V0 | Beyond V0 |
|---|---|---|
| A — Event lifecycle | `US-A1` | `US-A2` |
| E — Gate | `US-E4`–`US-E5` | — |

A closing paragraph.
