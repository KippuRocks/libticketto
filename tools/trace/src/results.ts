// Reads test titles from result files — features/004-conformance/plan.md §5.5.
//
// Two formats, both written by Vitest's own reporters: `--reporter=json`
// (Jest-compatible JSON) and `--reporter=junit`. A title is the test's own name
// with the names of the blocks around it. Skipped and to-do tests are not read:
// a test that did not run verifies nothing.

export interface TestTitle {
  /** The names of the enclosing blocks, outermost first, then the test's own. */
  readonly path: readonly string[];
  /** The result file it came from. */
  readonly source: string;
}

export class ResultsError extends Error {
  override name = "ResultsError";
}

interface JsonAssertion {
  readonly ancestorTitles?: readonly string[];
  readonly title?: string;
  readonly status?: string;
}

const NOT_RUN = new Set(["skipped", "pending", "todo", "disabled"]);

/** Reads a result file's contents; the format is told apart by its first character. */
export function readTitles(contents: string, source: string): TestTitle[] {
  const text = contents.trimStart();
  if (text.startsWith("{")) return fromJson(text, source);
  if (text.startsWith("<")) return fromJunit(text, source);
  throw new ResultsError(`${source}: neither Vitest JSON nor JUnit XML`);
}

function fromJson(text: string, source: string): TestTitle[] {
  let parsed: { testResults?: { assertionResults?: JsonAssertion[] }[] };
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ResultsError(`${source}: invalid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.testResults)) {
    throw new ResultsError(`${source}: no "testResults" — not a Vitest JSON report`);
  }
  const titles: TestTitle[] = [];
  for (const file of parsed.testResults) {
    for (const test of file.assertionResults ?? []) {
      if (typeof test.title !== "string") continue;
      if (test.status !== undefined && NOT_RUN.has(test.status)) continue;
      titles.push({ path: [...(test.ancestorTitles ?? []), test.title], source });
    }
  }
  return titles;
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(?:lt|gt|amp|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

function fromJunit(text: string, source: string): TestTitle[] {
  if (!/<testsuites?\b/.test(text)) {
    throw new ResultsError(`${source}: no <testsuites> or <testsuite> — not a JUnit report`);
  }
  const titles: TestTitle[] = [];
  const testcase = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of text.matchAll(testcase)) {
    const name = /\bname="([^"]*)"/.exec(match[1] ?? "");
    if (name === null) continue;
    if (/<skipped\b/.test(match[3] ?? "")) continue;
    // Vitest's JUnit reporter joins a test's block names and its own with " > ".
    titles.push({ path: decodeEntities(name[1] as string).split(" > "), source });
  }
  return titles;
}
