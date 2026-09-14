// The dependency rules of `features/001-workspace/plan.md` §5.2, as data.
//
// How the table is read:
//
// - "May depend on" is exhaustive for what a package ships: its `dependencies`,
//   `peerDependencies` and `optionalDependencies`, and every import in its
//   non-test sources. An internal package not listed is a violation.
// - "Must never depend on" binds everything, including `devDependencies` and
//   test sources.
// - "(types only)" means the edge may carry `import type` / `export type` and
//   nothing that survives compilation.
// - "Any backend" is every `@ticketto/backend-*` and `@ticketto/binding-*`.
// - "Any I/O" is any Node.js built-in module.
// - A third-party package (`@noble/*`, `scale-ts`, `rxjs`, …) is not internal
//   and is not governed by the table: `rx`'s RxJS peer dependency needs no entry.
//
// A package with no row is not checked: the plan has not ruled its edges, and
// this tool does not rule them either.

export const INTERNAL_SCOPE = "@ticketto/";

export interface Allowed {
  readonly name: string;
  readonly typesOnly?: boolean;
}

export interface Rule {
  readonly allow: readonly Allowed[];
  readonly forbidBackends: boolean;
  readonly forbid: readonly string[];
  readonly forbidIo: boolean;
}

const pkg = (name: string) => `${INTERNAL_SCOPE}${name}`;

export const RULES: Readonly<Record<string, Rule>> = {
  [pkg("sdk")]: {
    allow: [],
    forbidBackends: true,
    forbid: [pkg("ledger-rules"), pkg("profile-v0")],
    forbidIo: false,
  },
  [pkg("profile-v0")]: {
    allow: [{ name: pkg("sdk"), typesOnly: true }],
    forbidBackends: true,
    forbid: [],
    forbidIo: false,
  },
  [pkg("ledger-rules")]: {
    allow: [{ name: pkg("sdk"), typesOnly: true }, { name: pkg("profile-v0") }],
    forbidBackends: true,
    forbid: [],
    forbidIo: true,
  },
  [pkg("backend-memory")]: {
    allow: [{ name: pkg("sdk") }, { name: pkg("ledger-rules") }, { name: pkg("log") }],
    forbidBackends: false,
    forbid: [pkg("binding-offchain")],
    forbidIo: false,
  },
  [pkg("binding-offchain")]: {
    allow: [{ name: pkg("sdk") }, { name: pkg("profile-v0") }],
    forbidBackends: false,
    forbid: [pkg("ledger-rules"), pkg("backend-memory")],
    forbidIo: false,
  },
  [pkg("conformance")]: {
    allow: [{ name: pkg("sdk") }, { name: pkg("profile-v0") }],
    forbidBackends: true,
    forbid: [],
    forbidIo: false,
  },
  [pkg("log")]: {
    allow: [{ name: pkg("sdk"), typesOnly: true }, { name: pkg("profile-v0") }],
    forbidBackends: true,
    forbid: [],
    forbidIo: false,
  },
  [pkg("rx")]: {
    allow: [{ name: pkg("sdk") }],
    forbidBackends: true,
    forbid: [pkg("ledger-rules")],
    forbidIo: false,
  },
};

export function isBackend(name: string): boolean {
  return name.startsWith(pkg("backend-")) || name.startsWith(pkg("binding-"));
}
