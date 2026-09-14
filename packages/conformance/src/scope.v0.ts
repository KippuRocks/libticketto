// The V0 scope of the conformance suite — features/004-conformance/plan.md §5.3
// (kippu-docs 178e9a4), SPEC.md §15, NFR-8.
//
// Curated, and checked against the spec: every live invariant of §9 and every
// live error of §10 is either in the V0 list, which the suite must cover, or out
// of it with a one-line reason. `scopeProblems` fails on anything in neither
// list, in both, or unknown to the spec, so nothing is silently left out.
//
// Tombstoned identifiers — renamed or withdrawn by an amendment — are not live:
// the generated `INVARIANT_IDS` and `TICKETTO_ERROR_CODES` exclude them, and so
// does this file.

import {
  INVARIANT_IDS,
  type InvariantId,
  TICKETTO_ERROR_CODES,
  TICKETTO_ERROR_ORIGINS,
  type TickettoErrorCode,
} from "@ticketto/sdk";

/** An identifier the scope classifies. */
export type ScopedId = InvariantId | TickettoErrorCode;

/** The scope of one release: what the suite covers, and what it leaves out and why. */
export interface Scope {
  readonly invariants: readonly InvariantId[];
  readonly errors: readonly TickettoErrorCode[];
  readonly outOfScope: { readonly [Id in ScopedId]?: string };
}

const EPIC_C = "Epic C (secondary market), beyond V0 (§15)";
const DEFERRED_TRANSFER = "deferred transfer (US-D2–US-D4), beyond V0 (§15)";
const PLATFORM = "platform error (§10 note, amendment 0003); verified in F-021";

/** V0: every invariant and ledger error V0 stories exercise (§15). */
export const SCOPE_V0: Scope = {
  invariants: [
    "INV-1",
    "INV-2",
    "INV-3",
    "INV-4",
    "INV-5",
    "INV-6",
    "INV-8",
    "INV-10",
    "INV-11",
    "INV-12",
    "INV-13",
    "INV-14",
    "INV-16",
  ],
  errors: [
    "ERR-CapacityExceeded",
    "ERR-EventSealed",
    "ERR-EventCancelled",
    "ERR-EventFinished",
    "ERR-InvalidTransition",
    "ERR-CannotAttend",
    "ERR-TicketExpired",
    "ERR-PolicyUndeterminable",
    "ERR-CannotTransfer",
    "ERR-InvalidPass",
    "ERR-PassExpired",
    "ERR-PassReplayed",
    "ERR-NotOwner",
    "ERR-CapacityBelowIssuance",
    "ERR-CapacityProofRequired",
    "ERR-RestrictionNotPermitted",
    "ERR-TicketIdExists",
    "ERR-UnknownZone",
    "ERR-ZoneInUse",
    "ERR-ZoneKindMismatch",
    "ERR-ZoneExists",
    "ERR-EventIdExists",
    "ERR-EventNotFound",
    "ERR-TicketNotFound",
    "ERR-OperationExpired",
    "ERR-InvalidAuthorisation",
    "ERR-OperationConflict",
  ],
  outOfScope: {
    "INV-7": EPIC_C,
    "INV-15":
      "deployment property, not observable through a single backend's port; verified in F-006 and F-010",
    "ERR-NotForSale": EPIC_C,
    "ERR-CannotPay": EPIC_C,
    "ERR-CannotResell": EPIC_C,
    "ERR-TicketEncumbered": `${EPIC_C}: nothing encumbers a ticket in V0`,
    "ERR-NoPendingClaim": DEFERRED_TRANSFER,
    "ERR-ClaimExpired": DEFERRED_TRANSFER,
    "ERR-UnknownClass": PLATFORM,
    "ERR-ClassQuotaExceeded": PLATFORM,
    "ERR-LedgerUnavailable":
      "raised by bindings, not by the ledger's rules (§10 note); verified in F-007",
    "ERR-SponsorshipRefused":
      "binding error (§10 note), not required by REQ-SDK-7; verified in F-007 and F-010",
  },
};

/** The live identifiers of the spec the SDK was generated from. */
export const SPEC_IDS: readonly ScopedId[] = [...INVARIANT_IDS, ...TICKETTO_ERROR_CODES];

/**
 * Everything wrong with `scope` against the spec's live identifiers: an id in
 * neither list, in both, listed twice, or not live in the spec; an out-of-scope
 * id without a reason; and an in-scope error no ledger can raise.
 */
export function scopeProblems(scope: Scope, specIds: readonly ScopedId[] = SPEC_IDS): string[] {
  const problems: string[] = [];
  const live = new Set<string>(specIds);
  const inScope = [...scope.invariants, ...scope.errors];
  const counts = new Map<string, number>();
  for (const id of inScope) counts.set(id, (counts.get(id) ?? 0) + 1);

  for (const [id, count] of counts) {
    if (count > 1) problems.push(`${id} is listed in scope ${count} times`);
    if (!live.has(id)) problems.push(`${id} is in scope but is not a live identifier of the spec`);
  }
  for (const [id, reason] of Object.entries(scope.outOfScope)) {
    if (!live.has(id))
      problems.push(`${id} is out of scope but is not a live identifier of the spec`);
    if (counts.has(id)) problems.push(`${id} is both in scope and out of scope`);
    if (typeof reason !== "string" || reason.trim() === "") {
      problems.push(`${id} is out of scope without a reason`);
    }
  }
  for (const id of specIds) {
    if (!counts.has(id) && !Object.hasOwn(scope.outOfScope, id)) {
      problems.push(`${id} is neither in scope nor out of scope`);
    }
  }
  for (const id of scope.errors) {
    const origin = (TICKETTO_ERROR_ORIGINS as Record<string, string>)[id];
    if (origin !== undefined && origin !== "ledger") {
      problems.push(
        `${id} is in scope but is a ${origin} error, which no ledger raises (§10 note)`,
      );
    }
  }
  for (const id of scope.invariants) {
    if (!id.startsWith("INV-")) problems.push(`${id} is listed as an invariant`);
  }
  for (const id of scope.errors) {
    if (!id.startsWith("ERR-")) problems.push(`${id} is listed as an error`);
  }
  return problems;
}
