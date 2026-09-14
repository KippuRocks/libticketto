// Reads the parts of SPEC.md the SDK surface is generated from: the error
// table of §10 with its note on where errors arise, and the invariant table of
// §9 (features/002-sdk/plan.md §5.3, §5.9).
//
// Tombstoned rows — "Renamed … by amendment" or "Withdrawn by amendment" — are
// kept in the spec so identifiers are never reused, and are excluded here.

export type ErrorOrigin = "ledger" | "platform" | "binding";

export interface SpecError {
  readonly id: string;
  readonly condition: string;
  readonly origin: ErrorOrigin;
}

export interface SpecInvariant {
  readonly id: string;
  readonly text: string;
}

export interface SpecSurface {
  readonly errors: readonly SpecError[];
  readonly invariants: readonly SpecInvariant[];
}

export class SpecParseError extends Error {
  override name = "SpecParseError";
}

interface Row {
  readonly id: string;
  readonly text: string;
}

const NOTE_MARKER = "**Errors by where they arise.**";

/** Parses §9 and §10 of a SPEC.md. Throws `SpecParseError` when either is not as expected. */
export function parseSpec(markdown: string): SpecSurface {
  const errorsSection = section(markdown, "10", "Errors");
  const invariantsSection = section(markdown, "9", "Invariants");

  const errorRows = live(tableRows(errorsSection, "ERR-"));
  const invariantRows = live(tableRows(invariantsSection, "INV-"));
  if (errorRows.length === 0) throw new SpecParseError("§10 has no live error rows");
  if (invariantRows.length === 0) throw new SpecParseError("§9 has no live invariant rows");

  const origins = originsFromNote(errorsSection, new Set(errorRows.map((row) => row.id)));
  return {
    errors: errorRows.map((row) => ({
      id: row.id,
      condition: row.text,
      origin: origins.get(row.id) ?? "ledger",
    })),
    invariants: invariantRows.map((row) => ({ id: row.id, text: row.text })),
  };
}

/** The body of `## <number>. <title>`, up to the next level-two heading. */
function section(markdown: string, number: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const heading = `## ${number}. ${title}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new SpecParseError(`heading "${heading}" not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Rows of the first two-column table whose first cell is a backticked `<prefix>…` id. */
function tableRows(body: string, prefix: string): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const line of body.split("\n")) {
    const match = /^\|\s*`([A-Za-z]+-[A-Za-z0-9]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const [, id, text] = match as unknown as [string, string, string];
    if (!id.startsWith(prefix)) continue;
    if (seen.has(id)) throw new SpecParseError(`${id} appears twice`);
    seen.add(id);
    rows.push({ id, text: text.trim() });
  }
  return rows;
}

/** Drops tombstoned rows. */
function live(rows: readonly Row[]): Row[] {
  return rows.filter((row) => !/^\*(Renamed|Withdrawn)\b/.test(row.text));
}

/**
 * Tags errors from §10's note. A sentence calling its errors "platform errors"
 * tags them `platform`; a sentence saying they are raised by a backend — a
 * backend binding, or a backend refusing a submission — tags them `binding`.
 * Every other error is `ledger`.
 *
 * The tags cannot say "platform or binding". An error the note says Kippu *or* a
 * backend raises (`ERR-SponsorshipRefused`, amendment 0003) is tagged `binding`:
 * what the tag must get right is that no ledger produces it (`REQ-SDK-7`), and a
 * binding is where a client meets it.
 */
function originsFromNote(body: string, live: ReadonlySet<string>): Map<string, ErrorOrigin> {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .find((p) => p.startsWith(NOTE_MARKER));
  if (paragraph === undefined) {
    throw new SpecParseError(`§10 has no note starting "${NOTE_MARKER}"`);
  }

  const origins = new Map<string, ErrorOrigin>();
  const sentences = paragraph.slice(NOTE_MARKER.length).split(/(?<=\.)\s+/);
  for (const sentence of sentences) {
    const ids = [...sentence.matchAll(/`(ERR-[A-Za-z0-9]+)`/g)].map((m) => m[1] as string);
    if (ids.length === 0) continue;
    const platform = /\bplatform errors?\b/i.test(sentence);
    const binding = /\bbackend\b/i.test(sentence);
    if (platform === binding) {
      throw new SpecParseError(
        `§10 note: cannot tell where ${ids.join(", ")} arise: "${sentence}"`,
      );
    }
    for (const id of ids) {
      if (!live.has(id)) throw new SpecParseError(`§10 note names ${id}, which has no live row`);
      if (origins.has(id)) throw new SpecParseError(`§10 note tags ${id} twice`);
      origins.set(id, platform ? "platform" : "binding");
    }
  }
  return origins;
}
