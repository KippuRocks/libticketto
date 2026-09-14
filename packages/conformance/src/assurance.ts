// Completeness of a backend's assurance declaration — REQ-SDK-6,
// features/004-conformance/plan.md §3.
//
// The declaration's type already requires an entry per invariant, but a backend
// reached across a wire, or built in JavaScript, is not held to it by a
// compiler. This checks the declaration the backend actually hands out.

import { type Assurance, INVARIANT_IDS } from "@ticketto/sdk";

const ASSURANCES: readonly Assurance[] = ["enforced", "attested"];

/**
 * Everything wrong with a declaration: an invariant of §9 with no entry, an
 * entry that is neither `enforced` nor `attested`, or an entry for something
 * that is not a live invariant.
 */
export function assuranceProblems(declaration: unknown): string[] {
  if (typeof declaration !== "object" || declaration === null) {
    return ["the assurance declaration is not an object"];
  }
  const entries = declaration as Record<string, unknown>;
  const problems: string[] = [];
  const live = new Set<string>(INVARIANT_IDS);
  for (const id of INVARIANT_IDS) {
    if (!Object.hasOwn(entries, id)) {
      problems.push(`${id} has no entry`);
    } else if (!ASSURANCES.includes(entries[id] as Assurance)) {
      problems.push(
        `${id} is declared ${JSON.stringify(entries[id])}, not "enforced" or "attested"`,
      );
    }
  }
  for (const key of Object.keys(entries)) {
    if (!live.has(key)) problems.push(`${key} is declared but is not a live invariant of §9`);
  }
  return problems;
}
