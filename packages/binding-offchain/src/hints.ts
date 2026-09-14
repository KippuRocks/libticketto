// C4.md §3.5 — the hint stream: server-sent events carrying cursors, never
// records (`AD-17`).
//
// The parser works on bytes as they arrive, so it needs no `TextDecoder` (which
// React Native does not provide by default). That is exact, not an
// approximation: every line that is not a comment must be ASCII — an event name,
// and a JSON object whose only value is a cursor from C4.md §1.4's alphabet — so
// a byte above 0x7f outside a comment is a defect, and comments are skipped
// without being decoded.

import type { Cursor } from "@ticketto/sdk";
import { isCursor } from "./wire.js";

/** A hint stream that is not C4 (C4.md §4.3): a defect, never a cursor. */
export class HintStreamDefect extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HintStreamDefect";
  }
}

const LF = 0x0a;
const CR = 0x0d;
const COLON = 0x3a;

/**
 * An incremental parser of C4's hint stream. `push` takes the next chunk of
 * bytes, split anywhere, and returns the cursors of the hints it completes.
 * Lines may end in LF, CR or CRLF, as in any event stream.
 */
export class HintParser {
  private line: number[] = [];
  private comment = false;
  private lastWasCr = false;
  private block: string[] = [];

  push(chunk: Uint8Array): Cursor[] {
    const cursors: Cursor[] = [];
    for (const byte of chunk) {
      if (this.lastWasCr) {
        this.lastWasCr = false;
        if (byte === LF) continue;
      }
      if (byte === LF || byte === CR) {
        this.lastWasCr = byte === CR;
        this.endLine(cursors);
        continue;
      }
      if (this.line.length === 0 && !this.comment && byte === COLON) {
        this.comment = true;
        continue;
      }
      if (this.comment) continue;
      if (byte > 0x7f) throw new HintStreamDefect("a hint line that is not ASCII");
      if (this.line.length >= 4096) throw new HintStreamDefect("a hint line too long for C4");
      this.line.push(byte);
    }
    return cursors;
  }

  /** Whether the stream ended between events, as a well-formed stream does. */
  get idle(): boolean {
    return this.line.length === 0 && !this.comment && this.block.length === 0;
  }

  private endLine(cursors: Cursor[]): void {
    if (this.comment) {
      this.comment = false;
      return;
    }
    if (this.line.length > 0) {
      this.block.push(String.fromCharCode(...this.line));
      this.line = [];
      return;
    }
    // A blank line dispatches the event.
    const block = this.block;
    this.block = [];
    if (block.length > 0) cursors.push(hintCursor(block));
  }
}

/** One field line: its name and value, with the single optional space after the colon removed. */
function field(line: string): [string, string] {
  const colon = line.indexOf(":");
  if (colon < 0) return [line, ""];
  const value = line.slice(colon + 1);
  return [line.slice(0, colon), value.startsWith(" ") ? value.slice(1) : value];
}

/** The cursor of one event: exactly `event: hint` and `data: {"cursor":"…"}` (C4.md §3.5). */
function hintCursor(block: readonly string[]): Cursor {
  const [first, second] = block;
  if (block.length !== 2 || first === undefined || second === undefined) {
    throw new HintStreamDefect("an event that is not a hint");
  }
  const [eventName, eventValue] = field(first);
  const [dataName, dataValue] = field(second);
  if (eventName !== "event" || eventValue !== "hint" || dataName !== "data") {
    throw new HintStreamDefect("an event that is not a hint");
  }
  let data: unknown;
  try {
    data = JSON.parse(dataValue) as unknown;
  } catch {
    throw new HintStreamDefect("a hint whose data is not JSON");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    Object.keys(data).length !== 1 ||
    !isCursor((data as { cursor?: unknown }).cursor)
  ) {
    throw new HintStreamDefect("a hint that carries no cursor");
  }
  return (data as { cursor: Cursor }).cursor;
}
