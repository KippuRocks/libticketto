// Whether a ticket admits — features/008-ledger-rules/plan.md §5.2 (access pass
// step 4), §5.3; SPEC.md REQ-Q-1–REQ-Q-4, US-B1.
//
// One evaluation, used by `canAttend` at the authority's clock and by
// `submitAccessPass` at the pass's presentation (plan §5.3; §7.E's note).

import type { AttendancePolicy, AttendanceVerdict, Event, Ticket, Timestamp } from "@ticketto/sdk";

const isTimestamp = (value: unknown): value is Timestamp =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isUntil = (value: unknown): value is Timestamp | null => value === null || isTimestamp(value);

/**
 * The policy, when it is one the rules can evaluate; `null` otherwise. A ticket
 * whose policy is missing or malformed never admits by default (`REQ-Q-4`).
 */
function determinable(policy: unknown): AttendancePolicy | null {
  if (typeof policy !== "object" || policy === null) return null;
  const candidate = policy as { kind?: unknown; max?: unknown; until?: unknown };
  switch (candidate.kind) {
    case "Single":
      return policy as AttendancePolicy;
    case "Multiple":
      return isTimestamp(candidate.max) && isUntil(candidate.until)
        ? (policy as AttendancePolicy)
        : null;
    case "Unlimited":
      return isUntil(candidate.until) ? (policy as AttendancePolicy) : null;
    default:
      return null;
  }
}

/**
 * Whether `ticket` of `event` admits at `at`, and why not if it does not. In
 * order (`REQ-Q-2`): the event is neither `Cancelled` (`ERR-EventCancelled`)
 * nor `Finished` (`ERR-EventFinished`); the policy is determinable
 * (`ERR-PolicyUndeterminable`); it has not expired — it admits at or before its
 * `until` (`ERR-TicketExpired`, `AC-B1.4`); its allowance is not exhausted —
 * `Single` once, `Multiple` `max` times, `Unlimited` without bound
 * (`ERR-CannotAttend`, `INV-5`). Reads nothing and writes nothing.
 */
export function attendanceVerdict(event: Event, ticket: Ticket, at: Timestamp): AttendanceVerdict {
  if (event.status === "Cancelled") return { admit: false, reason: "ERR-EventCancelled" };
  if (event.status === "Finished") return { admit: false, reason: "ERR-EventFinished" };

  const policy = determinable(ticket.policy);
  if (policy === null) return { admit: false, reason: "ERR-PolicyUndeterminable" };

  if (policy.kind !== "Single" && policy.until !== null && at > policy.until) {
    return { admit: false, reason: "ERR-TicketExpired" };
  }
  const allowance = policy.kind === "Single" ? 1 : policy.kind === "Multiple" ? policy.max : null;
  if (allowance !== null && ticket.attendances >= allowance) {
    return { admit: false, reason: "ERR-CannotAttend" };
  }
  return { admit: true };
}
