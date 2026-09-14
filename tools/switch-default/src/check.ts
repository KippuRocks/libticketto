// Forbids a `switch` over `Command` kinds or `TickettoErrorCode` values that
// has no `default` — features/002-sdk/plan.md §5.6.
//
// Beyond-V0 commands and new §10 errors are added to those unions later. A
// consumer that switches over every member without a default stops compiling,
// or silently ignores the new member, when that happens. Requiring a default
// keeps those additions non-breaking by construction (REQ-SDK-1).
//
// Biome cannot see types, and neither can this check. It recognises a switch
// by its case labels instead: any string literal that is a `Command` kind or a
// `TickettoErrorCode` marks the switch as one over those unions. Both sets are
// read from the SDK's own sources, so they follow the surface as it grows.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

export interface Guarded {
  readonly commandKinds: ReadonlySet<string>;
  readonly errorCodes: ReadonlySet<string>;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly union: "Command" | "TickettoErrorCode";
}

interface Node {
  readonly type: string;
  readonly start: number;
  readonly [key: string]: unknown;
}

const SDK = join("packages", "sdk", "src");

/** Reads the command kinds and error codes from the SDK's sources. */
export function guardedLiterals(root: string): Guarded {
  return {
    commandKinds: commandKinds(join(root, SDK, "commands.ts")),
    errorCodes: errorCodes(join(root, SDK, "generated", "spec.ts")),
  };
}

/** `kind` literals of the interfaces named in `type Command = A | B | …`. */
function commandKinds(file: string): Set<string> {
  const program = parse(file);
  const members = new Set<string>();
  const kinds = new Map<string, string>();
  walk(program, (node) => {
    if (node.type === "TSTypeAliasDeclaration" && name(node.id) === "Command") {
      walk(node.typeAnnotation, (ref) => {
        if (ref.type === "TSTypeReference") members.add(name(ref.typeName) ?? "");
      });
    }
    if (node.type === "TSInterfaceDeclaration") {
      const interfaceName = name(node.id);
      walk(node.body, (property) => {
        if (property.type !== "TSPropertySignature" || name(property.key) !== "kind") return;
        walk(property.typeAnnotation, (literal) => {
          if (literal.type === "Literal" && typeof literal.value === "string" && interfaceName) {
            kinds.set(interfaceName, literal.value);
          }
        });
      });
    }
  });
  const found = new Set<string>();
  for (const member of members) {
    const kind = kinds.get(member);
    if (kind === undefined)
      throw new Error(`${file}: Command member ${member} has no kind literal`);
    found.add(kind);
  }
  if (found.size === 0) throw new Error(`${file}: no Command union found`);
  return found;
}

/** The string elements of `TICKETTO_ERROR_CODES`. */
function errorCodes(file: string): Set<string> {
  const found = new Set<string>();
  walk(parse(file), (node) => {
    if (node.type !== "VariableDeclarator" || name(node.id) !== "TICKETTO_ERROR_CODES") return;
    walk(node.init, (literal) => {
      if (literal.type === "Literal" && typeof literal.value === "string") found.add(literal.value);
    });
  });
  if (found.size === 0) throw new Error(`${file}: no TICKETTO_ERROR_CODES found`);
  return found;
}

/** Violations in one source file. */
export function checkSource(file: string, source: string, guarded: Guarded): Violation[] {
  const violations: Violation[] = [];
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let line = 0;
    while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? 0) <= offset) line += 1;
    return line + 1;
  };

  walk(parse(file, source), (node) => {
    if (node.type !== "SwitchStatement") return;
    const cases = node.cases as Node[];
    if (cases.some((c) => c.test === null)) return;
    const labels = cases
      .map((c) => c.test as Node)
      .filter((test) => test.type === "Literal" && typeof test.value === "string")
      .map((test) => test.value as string);
    const union = labels.some((l) => guarded.commandKinds.has(l))
      ? "Command"
      : labels.some((l) => guarded.errorCodes.has(l))
        ? "TickettoErrorCode"
        : undefined;
    if (union !== undefined) violations.push({ file, line: lineOf(node.start), union });
  });
  return violations;
}

/** TypeScript and JavaScript sources the workspace ships or tests: every `src/` and `test/`. */
export function sourceFiles(root: string): string[] {
  const dirs = [join(root, "test")];
  for (const group of ["packages", "tools"]) {
    let members: string[] = [];
    try {
      members = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const member of members) dirs.push(join(root, group, member, "src"));
  }
  return dirs.flatMap((dir) => {
    try {
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(c|m)?(t|j)sx?$/.test(f) && !f.endsWith(".d.ts"))
        .filter((f) => !f.split(/[\\/]/).some((part) => part === "node_modules"))
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  });
}

/** Every violation in the workspace, with paths relative to `root`. */
export function checkWorkspace(root: string): Violation[] {
  const guarded = guardedLiterals(root);
  return sourceFiles(root).flatMap((file) =>
    checkSource(relative(root, file), readFileSync(file, "utf8"), guarded),
  );
}

export function format(violations: readonly Violation[]): string {
  if (violations.length === 0)
    return "switch-default: no default-less switch over Command or TickettoErrorCode";
  return [
    `switch-default: ${violations.length} switch(es) without a default (features/002-sdk/plan.md §5.6)`,
    ...violations.map(
      (v) =>
        `  ${v.file}:${v.line}: switch over ${v.union} has no default; later additions to ${v.union} must not break it`,
    ),
  ].join("\n");
}

function parse(file: string, source = readFileSync(file, "utf8")): Node {
  const result = parseSync(file, source);
  if (result.errors.length > 0) {
    throw new Error(`${file}: ${result.errors.map((e) => e.message).join("; ")}`);
  }
  return result.program as unknown as Node;
}

function name(value: unknown): string | undefined {
  const node = value as { name?: unknown } | null | undefined;
  return typeof node?.name === "string" ? node.name : undefined;
}

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Node;
  if (typeof node.type === "string") visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}
