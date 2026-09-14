// T-006-01 — the NFR-6 allow-list: a field it does not name never reaches the log.

import type { Command, CommandKind } from "@ticketto/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMANDS, eventOf, samplePass, signCommand } from "../test/fixtures.js";
import { COMMAND_FIELDS } from "./allow-list.js";
import { type ChainedRecord, encodeRecord, LogContentError, type LogInput } from "./index.js";

// The allow-list names exactly the SDK's fields for every command kind: adding a
// field to a command without reviewing it into the list fails this typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const listsExactlyTheSdkFields: {
  [K in CommandKind]: Same<keyof (typeof COMMAND_FIELDS)[K], keyof Extract<Command, { kind: K }>>;
} = {
  createEvent: true,
  setEventStatus: true,
  setEventCapacity: true,
  addZone: true,
  removeZone: true,
  issueTicket: true,
  transferTicket: true,
  removeRestriction: true,
  registerCredential: true,
};

let issue: LogInput;
let pass: LogInput;

beforeAll(async () => {
  issue = await signCommand(COMMANDS.issueTicket);
  pass = await samplePass();
});

function record(input: LogInput, extra: object = {}): ChainedRecord {
  return {
    sequence: 1,
    event: eventOf(input, 0),
    recordedAt: 1,
    input,
    presentedAt: null,
    prevHash: "00".repeat(32),
    ...extra,
  };
}

function rejectedAt(value: ChainedRecord): string {
  try {
    encodeRecord(value);
  } catch (error) {
    if (error instanceof LogContentError) return error.path;
    throw error;
  }
  throw new Error("accepted");
}

describe("NFR-6 the record allow-list", () => {
  it("names every V0 command kind's fields exactly", () => {
    expect(Object.values(listsExactlyTheSdkFields).every(Boolean)).toBe(true);
    expect(Object.keys(COMMAND_FIELDS).sort()).toEqual(Object.keys(COMMANDS).sort());
  });

  it("accepts every V0 input as the SDK shapes it", async () => {
    for (const command of Object.values(COMMANDS)) {
      const input = await signCommand(command);
      expect(() => encodeRecord(record(input))).not.toThrow();
    }
    expect(() => encodeRecord(record(pass))).not.toThrow();
  });

  it("rejects an unknown field on a command", () => {
    const smuggled = {
      ...issue,
      command: { ...(issue as { command: object }).command, email: "a@b.c" },
    };
    expect(rejectedAt(record(smuggled as unknown as LogInput))).toBe("record.input.command.email");
  });

  it("rejects an unknown field nested in a command's values", () => {
    const command = COMMANDS.issueTicket as Extract<Command, { kind: "issueTicket" }>;
    const inPlacement = {
      ...issue,
      command: { ...command, placement: { ...command.placement, name: "Ada" } },
    };
    expect(rejectedAt(record(inPlacement as unknown as LogInput))).toBe(
      "record.input.command.placement.name",
    );
    const inPolicy = { ...issue, command: { ...command, policy: { kind: "Single", phone: "1" } } };
    expect(rejectedAt(record(inPolicy as unknown as LogInput))).toBe(
      "record.input.command.policy.phone",
    );
    const create = COMMANDS.createEvent as Extract<Command, { kind: "createEvent" }>;
    const zones = [{ ...create.zones[0], label: "VIP for Ada" }];
    const inZone = {
      command: { ...create, zones },
      authorisation: (issue as { authorisation: Uint8Array }).authorisation,
    };
    expect(rejectedAt(record(inZone as unknown as LogInput))).toBe(
      "record.input.command.zones[0].label",
    );
  });

  it("rejects a named property hung on a list", () => {
    const create = COMMANDS.createEvent as Extract<Command, { kind: "createEvent" }>;
    const zones = Object.assign([...create.zones], { owner: "Ada" });
    const input = { command: { ...create, zones }, authorisation: new Uint8Array(1) };
    expect(rejectedAt(record(input as unknown as LogInput))).toBe(
      "record.input.command.zones.owner",
    );
  });

  it("rejects an unknown field on a pass, on the signed input, and on the record", () => {
    const signed = pass as { pass: object; authorisation: Uint8Array };
    const onPass = { ...signed, pass: { ...signed.pass, seat: "Ada Lovelace" } };
    expect(rejectedAt(record(onPass as unknown as LogInput))).toBe("record.input.pass.seat");
    const onInput = { ...signed, holderName: "Ada" };
    expect(rejectedAt(record(onInput as unknown as LogInput))).toBe("record.input.holderName");
    expect(rejectedAt(record(pass, { note: "Ada" }))).toBe("record.note");
    const onEvent = record(pass, { event: { id: eventOf(pass, 0)?.id, sequence: 0, title: "x" } });
    expect(rejectedAt(onEvent)).toBe("record.event.title");
  });

  it("rejects a command kind it does not name", () => {
    const future = { ...issue, command: { kind: "setHolderProfile", name: "Ada" } };
    expect(rejectedAt(record(future as unknown as LogInput))).toBe("record.input.command.kind");
  });

  it("rejects an input that is neither a signed command nor a signed pass", () => {
    const both = { ...issue, pass: (pass as { pass: object }).pass };
    expect(rejectedAt(record(both as unknown as LogInput))).toBe("record.input");
  });
});
