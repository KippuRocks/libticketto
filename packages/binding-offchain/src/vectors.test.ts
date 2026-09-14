/// <reference types="node" />
// T-007-01 on Node: the portable suites under Vitest, plus what needs Node — the
// vendored file's recorded digest, and the vectors' decoded columns against this
// repository's profile, so a profile change that the vectors no longer match
// fails here rather than against the service.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSignedAccessPass, decodeSignedCommand } from "@ticketto/profile-v0";
import type { Sponsorship } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { BASE_URL, scriptedFetch } from "../test/fake-fetch.js";
import { FakeService } from "../test/fake-service.js";
import { clientSuite } from "../test/suites/client.suite.js";
import { submitSuite } from "../test/suites/submit.suite.js";
import { assertMapped, translationSuite } from "../test/suites/translation.suite.js";
import { type C4Vectors, type Exchange, vectorsSuite } from "../test/suites/vectors.suite.js";
import { createC4Client } from "./client.js";
import { fromHex, toHex } from "./hex.js";
import { createOffchainSubmit } from "./submit.js";
import { WIRE_CODES, WIRE_TRANSLATION, type WireCode } from "./translation.js";
import { ENDPOINTS } from "./wire.js";

const dir = join(import.meta.dirname, "..", "test", "c4");
const raw = readFileSync(join(dir, "c4-v0.json"));
const document = readFileSync(join(dir, "C4.md"), "utf8");
const source = JSON.parse(readFileSync(join(dir, "source.json"), "utf8")) as {
  repository: string;
  commit: string;
  files: { path: string; file: string; sha256: string }[];
};
const vectors = JSON.parse(raw.toString("utf8")) as C4Vectors & {
  exchanges: (Exchange & { decoded?: Record<string, unknown> })[];
};

describe("T-007-01 vendored C4 vectors", () => {
  it("are the files recorded in test/c4/source.json", () => {
    expect(source.repository).toBe("https://github.com/KippuRocks/ticketto-offchain.git");
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.files.map((f) => f.path).sort()).toEqual([
      "protocol/C4.md",
      "protocol/vectors/c4-v0.json",
    ]);
    for (const file of source.files) {
      const bytes = readFileSync(join(dir, file.file));
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(file.sha256);
    }
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

describe("T-007-04 error translation against C4.md", () => {
  const section = (from: string, to: string) =>
    document.slice(document.indexOf(from), document.indexOf(to, document.indexOf(from)));
  const rows = (text: string) =>
    text
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("|---"))
      .map((line) =>
        line
          .slice(1, -1)
          .split(" | ")
          .map((cell) => cell.trim()),
      );

  it("§4.2 lists exactly the wire codes and statuses the table maps", () => {
    const documented = rows(section("### 4.2 Wire errors", "### 4.3"))
      .slice(1)
      .map(([status, code]) => `${code?.replaceAll("`", "")}:${status?.replaceAll("`", "")}`);
    assertMapped(
      documented.map((entry) => entry.split(":")[0] as string),
      "C4.md §4.2",
    );
    const mapped = Object.entries(WIRE_TRANSLATION).flatMap(([code, entry]) =>
      entry.statuses.map((status) => `${code}:${status}`),
    );
    expect(documented.sort()).toEqual(mapped.sort());
  });

  it("§4.2 sends each endpoint-specific code only from the endpoint its section names", () => {
    const sections = Object.fromEntries(
      rows(section("## 2. Endpoints", "## 3."))
        .slice(1)
        .map(([endpoint, , ref]) => [ref?.replaceAll("`", ""), endpoint?.replaceAll("`", "")]),
    ) as Record<string, string>;
    for (const [, code, raised] of rows(section("### 4.2 Wire errors", "### 4.3")).slice(1)) {
      const name = (code ?? "").replaceAll("`", "") as WireCode;
      const ref = /^(§3\.\d)/.exec(raised ?? "")?.[1];
      const endpoints = WIRE_TRANSLATION[name].endpoints;
      if (ref === undefined) expect(endpoints, name).toEqual(ENDPOINTS);
      else expect(endpoints, name).toEqual([sections[ref]]);
    }
  });

  it("§4.3 gives each wire code the row the table does", () => {
    let checked = 0;
    for (const [received, surface] of rows(section("### 4.3 Translation", "## 5.")).slice(1)) {
      for (const match of (received ?? "").matchAll(/`(\d{3}) ([a-z-]+)`/g)) {
        const code = match[2] as string;
        if (!Object.hasOwn(WIRE_TRANSLATION, code)) continue; // `422 rejection`, `200 pending`, …
        const { translation } = WIRE_TRANSLATION[code as WireCode];
        const text = surface ?? "";
        if (text.includes("**Defect.**")) expect(translation, code).toEqual({ row: "defect" });
        else if (text.startsWith("Retry")) expect(translation, code).toEqual({ row: "retry" });
        else if (text.startsWith("Resubmit"))
          expect(translation, code).toEqual({ row: "resubmit" });
        else {
          const rejected = /^`rejected` with `(ERR-[A-Za-z]+)`/.exec(text)?.[1];
          expect(rejected, `${code}: ${text}`).toBeDefined();
          expect(translation, code).toEqual({ row: "rejected", code: rejected });
        }
        checked++;
      }
    }
    expect(checked).toBe(Object.values(WIRE_CODES).flat().length);
  });
});

describe("T-007-02 submit on Node", () => {
  it("REQ-CM-1: retries on the platform's own timers, resending the identical request", async () => {
    const service = new FakeService({ faults: ["drop-after", "drop-before"] });
    const submit = createOffchainSubmit({
      client: createC4Client({ url: BASE_URL, fetch: service.fetch }),
      retry: { initialDelay: 1, maxDelay: 2 },
    });
    const exchange = vectors.exchanges.find((e) => e.name.includes("transferTicket by the holder"));
    const body = exchange?.request.body as { input: { bytes: string }; sponsorship: string };
    const decoded = decodeSignedCommand(fromHex(body.input.bytes));
    if (!decoded.ok) throw new Error("the vector does not decode");
    const result = await submit(
      { kind: "command", signed: decoded.value },
      fromHex(body.sponsorship) as Sponsorship,
    );
    expect(result.ok).toBe(true);
    expect(service.recorded).toHaveLength(1);
    expect(new Set(service.submits).size).toBe(1);
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
submitSuite(vectors)({ describe, it });
translationSuite(vectors)({ describe, it });
