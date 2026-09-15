// Randomised choices for the concurrency variant, drawn from the backend's seeded
// source (TestControls), so a failing run can be replayed.

import type { World } from "../../world.js";

export interface Random {
  /** A whole number in [min, max]. */
  int(min: number, max: number): number;
  /** `items` in a random order. */
  shuffle<T>(items: readonly T[]): T[];
}

export function randomFor(world: World): Random {
  const next = () => {
    const bytes = world.backend.randomBytes(4);
    return (
      (((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0)) >>>
      0
    );
  };
  const int = (min: number, max: number) => min + (next() % (max - min + 1));
  return {
    int,
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
}

/** Starts `jobs` concurrently, in random order, each after a random number of microtask turns. */
export async function race<T>(
  random: Random,
  jobs: readonly (() => PromiseLike<T>)[],
): Promise<T[]> {
  const order = random.shuffle(jobs.map((job, index) => ({ job, index })));
  const results = new Array<T>(jobs.length);
  await Promise.all(
    order.map(async ({ job, index }) => {
      for (let turns = random.int(0, 3); turns > 0; turns--) await Promise.resolve();
      results[index] = await job();
    }),
  );
  return results;
}

/** How many randomised runs each concurrency test makes (T-004-08). */
export const RUNS = 1_000;
