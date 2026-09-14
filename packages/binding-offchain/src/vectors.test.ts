/// <reference types="node" />
// T-007-01 on Node: the portable suites under Vitest, plus what needs Node — the
// vendored file's recorded digest, and the vectors' decoded columns against this
// repository's profile, so a profile change that the vectors no longer match
// fails here rather than against the service.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSignedAccessPass, decodeSignedCommand } from "@ticketto/profile-v0";
import { describe, expect, it } from "vitest";
import { scriptedFetch } from "../test/fake-fetch.js";
import { clientSuite } from "../test/suites/client.suite.js";
import { type C4Vectors, type Exchange, vectorsSuite } from "../test/suites/vectors.suite.js";
import { createC4Client } from "./client.js";
import { fromHex, toHex } from "./hex.js";

const dir = join(import.meta.dirname, "..", "test", "c4");
const raw = readFileSync(join(dir, "c4-v0.json"));
const source = JSON.parse(readFileSync(join(dir, "source.json"), "utf8")) as {
  repository: string;
  commit: string;
  path: string;
  sha256: string;
};
const vectors = JSON.parse(raw.toString("utf8")) as C4Vectors & {
  exchanges: (Exchange & { decoded?: Record<string, unknown> })[];
};

describe("T-007-01 vendored C4 vectors", () => {
  it("are the file recorded in test/c4/source.json", () => {
    expect(source.repository).toBe("https://github.com/KippuRocks/ticketto-offchain.git");
    expect(source.path).toBe("protocol/vectors/c4-v0.json");
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(source.sha256);
  });

  const sdkJson = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? toHex(v) : v)));
  const decode = (input: { kind: string; bytes: string }) =>
    input.kind === "command"
      ? decodeSignedCommand(fromHex(input.bytes))
      : decodeSignedAccessPass(fromHex(input.bytes));

  it("decode with this repository's profile to the SDK values they record", () => {
    let checked = 0;
    for (const e of vectors.exchanges) {
      const body = e.request.body as Record<string, unknown> | undefined;
      const decoded = e.decoded;
      if (decoded?.input !== undefined && body !== undefined) {
        const result = decode(body.input as { kind: string; bytes: string });
        expect(result.ok, e.name).toBe(true);
        expect(sdkJson(result.ok ? result.value : undefined), e.name).toEqual(decoded.input);
        checked++;
      }
      if (decoded?.entries !== undefined && !("transport" in e.response)) {
        const records = (
          e.response.body as { records: { entry: { kind: string; bytes: string } }[] }
        ).records;
        expect(
          records.map((record) => sdkJson((decode(record.entry) as { value: unknown }).value)),
          e.name,
        ).toEqual(decoded.entries);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("refused at submission exactly where this repository's profile refuses to decode", () => {
    for (const e of vectors.exchanges) {
      if ("transport" in e.response || e.response.status !== 422) continue;
      const input = (e.request.body as { input: { kind: string; bytes: string } }).input;
      const result = decode(input);
      const rejection = (e.response.body as { rejection: { code: string } }).rejection;
      expect(result.ok ? undefined : result.error.code, e.name).toBe(rejection.code);
    }
  });
});

describe("T-007-01 C4 client on Node", () => {
  it("uses the platform's fetch when given none", async () => {
    const scripted = scriptedFetch([{ status: 200, text: '{"head":"","checkpoint":null}' }]);
    const platform = globalThis.fetch;
    globalThis.fetch = scripted.fetch as unknown as typeof globalThis.fetch;
    try {
      const client = createC4Client({ url: "https://ledger.example" });
      expect(await client.latestCheckpoint()).toEqual({
        outcome: "value",
        value: { head: "", checkpoint: null },
      });
    } finally {
      globalThis.fetch = platform;
    }
    expect(scripted.seen.map((request) => request.url)).toEqual([
      "https://ledger.example/v0/checkpoints/latest",
    ]);
  });
});

vectorsSuite(vectors)({ describe, it });
clientSuite({ describe, it });
