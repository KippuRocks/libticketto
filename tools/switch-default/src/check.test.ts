import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSource, checkWorkspace, format, guardedLiterals } from "./check.js";

const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const fixtures = join(import.meta.dirname, "..", "fixtures");
const guarded = guardedLiterals(workspaceRoot);

const check = (fixture: string) =>
  checkSource(fixture, readFileSync(join(fixtures, fixture), "utf8"), guarded);

describe("guarded literals", () => {
  it("reads every Command kind from the SDK", () => {
    expect([...guarded.commandKinds].sort()).toEqual(
      [
        "addZone",
        "createEvent",
        "issueTicket",
        "registerCredential",
        "removeRestriction",
        "removeZone",
        "setEventCapacity",
        "setEventStatus",
        "transferTicket",
      ].sort(),
    );
  });

  it("reads every generated error code from the SDK", () => {
    expect(guarded.errorCodes.has("ERR-CannotPay")).toBe(true);
    expect(guarded.errorCodes.has("ERR-BalanceLow")).toBe(false);
  });
});

describe("switch-default", () => {
  it("fails a default-less exhaustive switch over Command", () => {
    expect(check("default-less.ts")).toEqual([
      { file: "default-less.ts", line: 6, union: "Command" },
    ]);
  });

  it("fails a default-less switch over TickettoErrorCode", () => {
    expect(check("default-less-error.ts")).toEqual([
      { file: "default-less-error.ts", line: 6, union: "TickettoErrorCode" },
    ]);
  });

  it("accepts switches that keep a default, and switches over other values", () => {
    expect(check("with-default.ts")).toEqual([]);
  });

  it("names the file, line and union in its report", () => {
    expect(format(check("default-less.ts"))).toContain(
      "default-less.ts:6: switch over Command has no default",
    );
  });

  it("finds no violation in the workspace's own sources", () => {
    expect(checkWorkspace(workspaceRoot)).toEqual([]);
  });
});
