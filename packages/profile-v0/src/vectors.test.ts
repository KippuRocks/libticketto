/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { buildVectors, vectorsSuite } from "../test/vectors/vectors.js";

const path = join(import.meta.dirname, "..", "vectors", "v0.json");

// `pnpm vectors:generate` rewrites the file; every other run checks it.
if (process.env.TICKETTO_WRITE_VECTORS !== undefined) {
  describe("T-003-08 vector generation", () => {
    it("writes vectors/v0.json", async () => {
      writeFileSync(path, `${JSON.stringify(await buildVectors(), null, 2)}\n`);
    });
  });
} else {
  vectorsSuite(JSON.parse(readFileSync(path, "utf8")))({ describe, it });
}
