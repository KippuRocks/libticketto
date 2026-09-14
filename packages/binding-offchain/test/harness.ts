// A portable test harness: the same suites run under Vitest on Node and under
// the Hermes VM (test/hermes), which has no test framework. Suites register
// cases through `Registrar` and assert with the helpers below, which throw.
// The same shape as `profile-v0`'s test harness, so suites read alike.

export type Case = () => void | Promise<void>;

export interface Registrar {
  describe(name: string, body: () => void): void;
  it(name: string, body: Case): void;
}

export type Suite = (t: Registrar) => void;

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new AssertionError(message);
}

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (v instanceof Uint8Array ? Array.from(v) : v));
  } catch {
    return String(value);
  }
}

/** Structural equality over plain objects, arrays, `Uint8Array`s and primitives. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (!deepEqual(keysA, keysB)) return false;
    return keysA.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

export function assertEqual(actual: unknown, expected: unknown, message = "values differ"): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      `${message}\n  actual:   ${describeValue(actual)}\n  expected: ${describeValue(expected)}`,
    );
  }
}

export function assertThrows(body: () => unknown, message = "expected a throw"): void {
  try {
    body();
  } catch {
    return;
  }
  throw new AssertionError(message);
}

export async function assertRejects(
  body: () => Promise<unknown>,
  name?: string,
  message = "expected a rejection",
): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (name !== undefined && !(error instanceof Error && error.name === name)) {
      throw new AssertionError(`${message}: expected ${name}, got ${String(error)}`);
    }
    return;
  }
  throw new AssertionError(message);
}

/** Runs `suites` without a framework; used by the Hermes entry point. */
export async function runSuites(
  suites: readonly Suite[],
  log: (line: string) => void,
): Promise<{ passed: number; failed: number }> {
  const cases: { name: string; body: Case }[] = [];
  const prefix: string[] = [];
  const registrar: Registrar = {
    describe(name, body) {
      prefix.push(name);
      try {
        body();
      } finally {
        prefix.pop();
      }
    },
    it(name, body) {
      cases.push({ name: [...prefix, name].join(" › "), body });
    },
  };
  for (const suite of suites) suite(registrar);

  let passed = 0;
  let failed = 0;
  for (const { name, body } of cases) {
    try {
      await body();
      passed++;
      log(`ok   ${name}`);
    } catch (error) {
      failed++;
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      log(`FAIL ${name}\n     ${detail}`);
    }
  }
  return { passed, failed };
}
