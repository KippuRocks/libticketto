// Reads the identifiers a SPEC.md defines — features/004-conformance/plan.md §5.5.
//
// An identifier is *defined* where the spec introduces it: a table row whose
// first cell is the identifier, a bold `**`ID`**` at the start of a line, or a
// list item `- `ID`` (acceptance criteria). It is *tombstoned* when its
// definition says it was renamed or withdrawn by an amendment; identifiers
// withdrawn along with it, named there as a range such as
// `AC-E4.1`–`AC-E4.4`, are tombstoned too. Identifiers are never reused, so a
// tombstone stays defined and must never be named by a test.

export type IdKind = "US" | "AC" | "REQ" | "INV" | "ERR" | "NFR" | "OQ" | "DEF";

export const ID_KINDS: readonly IdKind[] = ["US", "AC", "REQ", "INV", "ERR", "NFR", "OQ", "DEF"];

const ID = `(?:${ID_KINDS.join("|")})-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*`;

export interface SpecIds {
  /** Every identifier defined and not tombstoned. */
  readonly live: ReadonlySet<string>;
  /** Every identifier renamed or withdrawn by an amendment. */
  readonly tombstoned: ReadonlySet<string>;
  /** The live user stories of the V0 release (§15, "Release scope"). */
  readonly v0Stories: ReadonlySet<string>;
}

export class SpecError extends Error {
  override name = "SpecError";
}

const DEFINITION = new RegExp(
  String.raw`^(?:\|\s*|\*\*|-\s+)\`(${ID})\`(?:\*\*)?\s*(?:\||—)?\s*(.*)$`,
);
const TOMBSTONE = /^\*(?:Renamed|Withdrawn)\b/;
const RANGE = new RegExp(String.raw`\`(${ID})\`\s*–\s*\`(${ID})\``, "g");

/** The identifiers a range `from`–`to` spans: the same stem, numbered from its first to its last. */
export function expandRange(from: string, to: string): string[] {
  const split = (id: string) => /^(.*?)(\d+)$/.exec(id);
  const a = split(from);
  const b = split(to);
  if (a === null || b === null || a[1] !== b[1]) return [from, to];
  const out: string[] = [];
  for (let n = Number(a[2]); n <= Number(b[2]); n++) out.push(`${a[1]}${n}`);
  return out;
}

export function parseSpecIds(markdown: string): SpecIds {
  const live = new Set<string>();
  const tombstoned = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = DEFINITION.exec(line.trim());
    if (match === null) continue;
    const [, id, rest] = match as unknown as [string, string, string];
    if (TOMBSTONE.test(rest.trim())) {
      tombstoned.add(id);
      for (const range of rest.matchAll(RANGE)) {
        for (const withdrawn of expandRange(range[1] as string, range[2] as string)) {
          tombstoned.add(withdrawn);
        }
      }
    } else {
      live.add(id);
    }
  }
  for (const id of tombstoned) live.delete(id);
  return { live, tombstoned, v0Stories: v0Stories(markdown, live) };
}

/** The V0 column of §15's release-scope table, with ranges expanded, live stories only. */
function v0Stories(markdown: string, live: ReadonlySet<string>): Set<string> {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^###\s+Release scope\s*$/.test(line.trim()));
  if (start === -1) throw new SpecError('§15 has no "### Release scope" table');
  const stories = new Set<string>();
  let header: string[] | undefined;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) break;
    if (!trimmed.startsWith("|")) {
      if (header !== undefined && trimmed !== "") break;
      continue;
    }
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (header === undefined) {
      header = cells;
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const column = header.indexOf("V0");
    if (column === -1) throw new SpecError('§15\'s release-scope table has no "V0" column');
    const cell = cells[column] ?? "";
    for (const range of cell.matchAll(RANGE)) {
      for (const id of expandRange(range[1] as string, range[2] as string)) {
        stories.add(id);
      }
    }
    for (const single of cell.matchAll(/`(US-[A-Za-z0-9]+)`/g)) {
      stories.add(single[1] as string);
    }
  }
  if (header === undefined) throw new SpecError("§15's release-scope table is empty");
  for (const id of stories) if (!live.has(id)) stories.delete(id);
  return stories;
}

/** The story an acceptance criterion belongs to: `AC-A1.3` → `US-A1`. */
export function storyOf(ac: string): string | undefined {
  const match = /^AC-([A-Za-z0-9]+)\.\d+$/.exec(ac);
  return match === null ? undefined : `US-${match[1]}`;
}

/** The identifier a test title (or one of its describe blocks) begins with, if any. */
export function leadingId(title: string): string | undefined {
  const match = new RegExp(`^(${ID})(?![A-Za-z0-9])`).exec(title.trim());
  return match?.[1];
}
