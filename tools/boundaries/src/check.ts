import { readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseSync } from "oxc-parser";
import { INTERNAL_SCOPE, isBackend, RULES, type Rule } from "./rules.js";

export interface Violation {
  /** The package breaking the rule. */
  readonly from: string;
  /** What it depends on: a package name, a Node.js built-in, or a path. */
  readonly to: string;
  /** Where: `package.json` or a source file, relative to the workspace root. */
  readonly where: string;
  readonly reason: string;
}

export interface Report {
  readonly checked: readonly string[];
  readonly unruled: readonly string[];
  readonly violations: readonly Violation[];
}

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** An edge found in a manifest or a source file. */
interface Edge {
  readonly specifier: string;
  readonly where: string;
  /** Ships with the package: a runtime manifest field or a non-test source. */
  readonly shipped: boolean;
  /** Erased at compile time (`import type`, `export type`, `import("x").T`). */
  readonly typeOnly: boolean;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"]);
const DEV_FILE =
  /(?:^|\/)(?:test|tests|__tests__|fixtures)\/|\.(?:test|spec)\.[^/]+$|\.config\.[^/]+$/;

export function checkWorkspace(root: string): Report {
  const packagesDir = join(root, "packages");
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name))
    .filter((dir) => exists(join(dir, "package.json")));

  const checked: string[] = [];
  const unruled: string[] = [];
  const violations: Violation[] = [];

  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
    const rule = RULES[manifest.name];
    if (rule === undefined) {
      unruled.push(manifest.name);
      continue;
    }
    checked.push(manifest.name);
    for (const edge of [...manifestEdges(root, dir, manifest), ...sourceEdges(root, dir)]) {
      const violation = judge(root, dir, manifest.name, rule, edge);
      if (violation !== undefined) violations.push(violation);
    }
  }

  return { checked, unruled, violations };
}

function judge(
  root: string,
  dir: string,
  from: string,
  rule: Rule,
  edge: Edge,
): Violation | undefined {
  const { specifier, where } = edge;
  const violation = (to: string, reason: string): Violation => ({ from, to, where, reason });

  if (specifier.startsWith(".")) {
    const target = resolve(dirname(join(root, where)), specifier);
    const rel = relative(dir, target);
    if (rel.startsWith("..") || rel.startsWith(sep)) {
      return violation(
        relative(root, target),
        "relative import escapes the package; depend on packages by name",
      );
    }
    return undefined;
  }

  if (isBuiltin(specifier)) {
    if (rule.forbidIo && edge.shipped && !edge.typeOnly) {
      return violation(specifier, `${from} must never perform I/O (Node.js built-in)`);
    }
    return undefined;
  }

  const target = packageName(specifier);
  if (!target.startsWith(INTERNAL_SCOPE) || target === from) return undefined;

  if (rule.forbid.includes(target)) {
    return violation(target, `${from} must never depend on ${target}`);
  }
  if (rule.forbidBackends && isBackend(target)) {
    return violation(target, `${from} must never depend on any backend`);
  }
  if (!edge.shipped) return undefined;

  const allowed = rule.allow.find((entry) => entry.name === target);
  if (allowed === undefined) {
    const may = rule.allow.map((entry) => entry.name).join(", ") || "nothing internal";
    return violation(target, `${from} may depend only on: ${may}`);
  }
  if (allowed.typesOnly === true && !edge.typeOnly && !where.endsWith("package.json")) {
    return violation(
      target,
      `${from} may depend on ${target} for types only; use \`import type\` or \`export type\``,
    );
  }
  return undefined;
}

function manifestEdges(root: string, dir: string, manifest: Manifest): Edge[] {
  const where = relative(root, join(dir, "package.json"));
  const fields: [Record<string, string> | undefined, boolean][] = [
    [manifest.dependencies, true],
    [manifest.peerDependencies, true],
    [manifest.optionalDependencies, true],
    [manifest.devDependencies, false],
  ];
  return fields.flatMap(([deps, shipped]) =>
    Object.keys(deps ?? {}).map((specifier) => ({ specifier, where, shipped, typeOnly: false })),
  );
}

function sourceEdges(root: string, dir: string): Edge[] {
  return sourceFiles(dir).flatMap((file) => {
    const where = relative(root, file);
    const shipped = !DEV_FILE.test(relative(dir, file).split(sep).join("/"));
    return importsOf(file).map(({ specifier, typeOnly }) => ({
      specifier,
      where,
      shipped,
      typeOnly: typeOnly || DECLARATION_FILE.test(file),
    }));
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

interface Import {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/** Every module specifier a file refers to, and whether the reference is erased. */
export function importsOf(file: string): Import[] {
  const result = parseSync(file, readFileSync(file, "utf8"));
  if (result.errors.length > 0) {
    throw new Error(`${file}: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  const found: Import[] = [];
  walk(result.program, (node) => {
    switch (node.type) {
      case "ImportDeclaration":
        // Only `import type` is erased. Under `verbatimModuleSyntax`,
        // `import { type X } from "m"` still emits `import {} from "m"`.
        push(found, node.source, node.importKind === "type");
        break;
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        push(found, node.source, node.exportKind === "type");
        break;
      case "ImportExpression":
        push(found, node.source, false);
        break;
      case "TSImportType":
        push(found, node.source, true);
        break;
      case "TSImportEqualsDeclaration": {
        const reference = node.moduleReference as Node | undefined;
        if (reference?.type === "TSExternalModuleReference") {
          push(found, reference.expression, node.importKind === "type");
        }
        break;
      }
      case "CallExpression": {
        const callee = node.callee as Node | undefined;
        const args = node.arguments as Node[] | undefined;
        if (callee?.type === "Identifier" && callee.name === "require") {
          push(found, args?.[0], false);
        }
        break;
      }
    }
  });
  return found;
}

type Node = Record<string, unknown>;

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

function push(found: Import[], source: unknown, typeOnly: boolean): void {
  const literal = source as Node | null | undefined;
  if (literal?.type === "Literal" && typeof literal.value === "string") {
    found.push({ specifier: literal.value, typeOnly });
  }
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function format(report: Report): string {
  const lines = report.violations.map(
    (v) => `  ✗ ${v.where}: ${v.from} → ${v.to}\n      ${v.reason}`,
  );
  const summary =
    report.violations.length === 0
      ? `boundaries: ${report.checked.length} packages checked, no violations`
      : `boundaries: ${report.violations.length} violation(s) of features/001-workspace/plan.md §5.2`;
  const unruled =
    report.unruled.length > 0
      ? [`  (no rule in §5.2, not checked: ${report.unruled.join(", ")})`]
      : [];
  return [summary, ...lines, ...unruled].join("\n");
}
