// ticketto-trace's check — features/004-conformance/plan.md §5.5, PLAN.md §6,
// NFR-8, SPEC.md §15.
//
// Required: every live acceptance criterion of a V0 story, and every invariant
// and error in the conformance scope. Covered: an identifier some test's title,
// or one of its blocks' names, begins with. The check fails on a required
// identifier nobody covers, and on a test naming an identifier the spec does
// not define or has tombstoned. An allow-list waives identifiers a repository
// is not yet required to cover — a gate story before its milestone.

import { type Scope, type ScopedId, scopeProblems } from "@ticketto/conformance";
import type { TestTitle } from "./results.js";
import { leadingId, type SpecIds, storyOf } from "./spec.js";

export interface TraceInput {
  readonly spec: SpecIds;
  readonly scope: Scope;
  readonly titles: readonly TestTitle[];
  /** Identifiers not required in this run. */
  readonly allow?: readonly string[];
}

export interface TraceReport {
  /** Identifiers this run requires: V0 acceptance criteria, and the scope's invariants and errors. */
  readonly required: readonly string[];
  /** Required identifiers some test names. */
  readonly covered: readonly string[];
  /** Every reason the run fails; empty when it passes. */
  readonly problems: readonly string[];
}

const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

export function trace({ spec, scope, titles, allow = [] }: TraceInput): TraceReport {
  const problems: string[] = [];

  // The scope must classify exactly the invariants and errors this spec defines.
  const specInvErr = [...spec.live].filter((id) => /^(INV|ERR)-/.test(id)) as ScopedId[];
  for (const problem of scopeProblems(scope, specInvErr)) problems.push(`scope: ${problem}`);

  const acceptance = [...spec.live].filter((id) => {
    const story = storyOf(id);
    return id.startsWith("AC-") && story !== undefined && spec.v0Stories.has(story);
  });
  const allowed = new Set(allow);
  for (const id of allowed) {
    if (!spec.live.has(id)) {
      problems.push(
        `allow-list: ${id} is ${spec.tombstoned.has(id) ? "tombstoned" : "not defined"} in the spec`,
      );
    }
  }
  const required = [...new Set([...acceptance, ...scope.invariants, ...scope.errors])]
    .filter((id) => !allowed.has(id))
    .sort(byId);

  const named = new Map<string, TestTitle>();
  for (const title of titles) {
    for (const part of title.path) {
      const id = leadingId(part);
      if (id === undefined) continue;
      if (spec.tombstoned.has(id)) {
        problems.push(
          `${id} is tombstoned, but a test names it: "${title.path.join(" > ")}" (${title.source})`,
        );
      } else if (!spec.live.has(id)) {
        problems.push(
          `${id} is not defined in the spec, but a test names it: "${title.path.join(" > ")}" (${title.source})`,
        );
      } else if (!named.has(id)) {
        named.set(id, title);
      }
    }
  }

  const covered = required.filter((id) => named.has(id));
  for (const id of required) {
    if (!named.has(id)) problems.push(`${id} has no test`);
  }
  return { required, covered, problems };
}
