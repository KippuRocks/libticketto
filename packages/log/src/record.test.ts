// T-006-01 — the record codec, its hash and domain separation (REQ-SDK-5).

import { blake2b256, encodeSignedAccessPass, encodeSignedCommand } from "@ticketto/profile-v0";
import type { CommandKind } from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMANDS, eventOf, samplePass, signCommand } from "../test/fixtures.js";
import { ascii, concatBytes, toHex } from "./bytes.js";
import {
  type ChainedRecord,
  decodeRecord,
  encodeRecord,
  GENESIS_HASH,
  hashRecord,
  hashRecordBytes,
  LogDecodeError,
  type LogInput,
  RECORD_VERSION,
} from "./index.js";

const inputs: [string, LogInput][] = [];

beforeAll(async () => {
  for (const kind of Object.keys(COMMANDS) as CommandKind[]) {
    inputs.push([kind, await signCommand(COMMANDS[kind])]);
  }
  inputs.push(["signed access pass", await samplePass()]);
});

function recordOf(input: LogInput, overrides: Partial<ChainedRecord> = {}): ChainedRecord {
  return {
    sequence: 7,
    event: eventOf(input, 3),
    recordedAt: 1_800_000_000_123,
    input,
    presentedAt: "pass" in input ? 1_800_000_000_100 : null,
    prevHash: "ab".repeat(32),
    ...overrides,
  };
}

describe("T-006-01 record codec round-trips", () => {
  it("every V0 command kind and a signed pass", () => {
    expect(inputs).toHaveLength(10);
    for (const [name, input] of inputs) {
      const record = recordOf(input);
      const bytes = encodeRecord(record);
      expect(bytes[0], name).toBe(RECORD_VERSION);
      expect(decodeRecord(bytes), name).toEqual(record);
      expect(encodeRecord(decodeRecord(bytes)), name).toEqual(bytes);
    }
  });

  it("the first record, with no event, no presentedAt and the genesis prevHash", () => {
    const input = inputs.find(([name]) => name === "registerCredential")?.[1] as LogInput;
    const record = recordOf(input, { sequence: 0, event: null, prevHash: GENESIS_HASH });
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
  });

  it("the largest safe integers in every u64 field", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const [, input] = inputs.at(-1) as [string, LogInput];
    const record = recordOf(input, {
      sequence: max,
      event: eventOf(input, max),
      recordedAt: max,
      presentedAt: max,
    });
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
  });

  it("carries the input as the profile's signed-input framing", () => {
    // version 1 + sequence 8 + Some 1 + event 32 + eventSequence 8 + recordedAt 8 = 58
    const [, pass] = inputs.at(-1) as [string, LogInput];
    const framedPass = encodeSignedAccessPass(pass as never);
    const passBytes = encodeRecord(recordOf(pass));
    expect(toHex(passBytes.subarray(58, 58 + framedPass.length))).toBe(toHex(framedPass));
    const [, command] = inputs[0] as [string, LogInput];
    const framedCommand = encodeSignedCommand(command as never);
    const commandBytes = encodeRecord(recordOf(command));
    expect(toHex(commandBytes.subarray(58, 58 + framedCommand.length))).toBe(toHex(framedCommand));
  });
});

describe("T-006-01 record codec refuses non-canonical bytes", () => {
  const sample = () => encodeRecord(recordOf(inputs[1]?.[1] as LogInput));

  it("an unknown record version", () => {
    const bytes = sample();
    bytes[0] = RECORD_VERSION + 1;
    expect(() => decodeRecord(bytes)).toThrow(LogDecodeError);
  });

  it("trailing bytes, and every truncation", () => {
    const bytes = sample();
    expect(() => decodeRecord(concatBytes(bytes, Uint8Array.of(0)))).toThrow(LogDecodeError);
    for (let cut = 0; cut < bytes.length; cut++) {
      expect(() => decodeRecord(bytes.subarray(0, cut))).toThrow(LogDecodeError);
    }
  });

  it("an option tag other than 0 or 1", () => {
    const bytes = sample();
    bytes[9] = 2;
    expect(() => decodeRecord(bytes)).toThrow(LogDecodeError);
  });

  it("an unknown signed-input kind or version", () => {
    const versioned = sample();
    versioned[58] = 1;
    expect(() => decodeRecord(versioned)).toThrow(LogDecodeError);
    const bytes = sample();
    bytes[59] = 2;
    expect(() => decodeRecord(bytes)).toThrow(LogDecodeError);
  });

  it("a u64 beyond the safe integer range", () => {
    const bytes = sample();
    bytes.fill(0xff, 1, 9);
    expect(() => decodeRecord(bytes)).toThrow(LogDecodeError);
  });

  it("a non-minimal compact length on the command bytes", () => {
    const bytes = sample();
    // The payload's length prefix follows the input's version and kind; widen it to two bytes.
    const length = (bytes[60] as number) >> 2;
    const widened = concatBytes(
      bytes.subarray(0, 60),
      Uint8Array.of(((length << 2) | 1) & 0xff, (length << 2) >> 8),
      bytes.subarray(61),
    );
    expect(() => decodeRecord(widened)).toThrow(LogDecodeError);
  });

  it("a command record naming another event, or none", () => {
    const [, input] = inputs[1] as [string, LogInput];
    const other = { id: "ee".repeat(32), sequence: 0 } as ChainedRecord["event"];
    expect(() => encodeRecord(recordOf(input, { event: other }))).toThrow(TypeError);
    expect(() => encodeRecord(recordOf(input, { event: null }))).toThrow(TypeError);
  });

  it("a registerCredential record naming an event, and a pass record naming none", () => {
    const register = inputs.find(([name]) => name === "registerCredential")?.[1] as LogInput;
    const event = { id: "ee".repeat(32), sequence: 0 } as ChainedRecord["event"];
    expect(() => encodeRecord(recordOf(register, { event }))).toThrow(TypeError);
    const [, pass] = inputs.at(-1) as [string, LogInput];
    expect(() => encodeRecord(recordOf(pass, { event: null }))).toThrow(TypeError);
  });

  it("a command record claiming a presentedAt", () => {
    const [, input] = inputs[1] as [string, LogInput];
    expect(() => encodeRecord(recordOf(input, { presentedAt: 1 }))).toThrow(TypeError);
  });

  it("values that cannot be encoded", () => {
    const [, input] = inputs[1] as [string, LogInput];
    expect(() => encodeRecord(recordOf(input, { sequence: -1 }))).toThrow(TypeError);
    expect(() => encodeRecord(recordOf(input, { recordedAt: 1.5 }))).toThrow(TypeError);
    expect(() => encodeRecord(recordOf(input, { prevHash: "AB".repeat(32) }))).toThrow(TypeError);
    expect(() => encodeRecord(recordOf(input, { prevHash: "ab" }))).toThrow(TypeError);
  });
});

describe("T-006-01 record hash", () => {
  it("is BLAKE2b-256 over the domain tag and the record bytes", () => {
    const record = recordOf(inputs[0]?.[1] as LogInput);
    const bytes = encodeRecord(record);
    const tag = ascii("ticketto/v0/log");
    expect(hashRecord(record)).toBe(toHex(blake2b256(concatBytes(tag, bytes))));
    expect(hashRecordBytes(bytes)).toBe(hashRecord(record));
  });

  it("is domain-separated: it is not the untagged hash of the same bytes", () => {
    const bytes = encodeRecord(recordOf(inputs[0]?.[1] as LogInput));
    expect(hashRecordBytes(bytes)).not.toBe(toHex(blake2b256(bytes)));
  });

  it("changes with every field", () => {
    const [, input] = inputs.at(-1) as [string, LogInput];
    const base = recordOf(input);
    const variants: Partial<ChainedRecord>[] = [
      { sequence: 8 },
      { event: eventOf(input, 4) },
      { recordedAt: base.recordedAt + 1 },
      { presentedAt: 1 },
      { prevHash: "ac".repeat(32) },
    ];
    const hashes = new Set([
      hashRecord(base),
      ...variants.map((v) => hashRecord(recordOf(input, v))),
    ]);
    expect(hashes.size).toBe(variants.length + 1);
  });
});
