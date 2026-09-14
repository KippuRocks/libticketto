// The NFR-6 content check (features/006-log-and-export/plan.md §5.1).
//
// The log is permanent and will be migrated into a public backend, so personal
// data must never reach it (NFR-6). The canonical encoding would silently drop a
// field it does not know; this check refuses one instead. Every field of a
// record's input must be named here — per command kind, and for every nested
// value — so a future command, or a caller attaching an extra property, cannot
// carry anything into the log that was not reviewed into this list.
//
// A command kind missing from `COMMAND_FIELDS` fails the typecheck; a kind the
// list does not know fails the check at run time.

import type { CommandKind } from "@ticketto/sdk";

/** Raised when a record carries a field the `NFR-6` allow-list does not name. */
export class LogContentError extends Error {
  /** Where the field sits, as a property path from the record. */
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LogContentError";
    this.path = path;
  }
}

/**
 * How a field is checked:
 * - `"scalar"` — a string, number, boolean or `null`; nothing to descend into.
 * - `"bytes"` — a `Uint8Array`, carried opaque (salt, authorisation, registration).
 * - an object shape — a plain object with exactly the listed fields at most.
 * - `{ list }` — an array whose items all have that shape.
 * - `{ variants }` — a plain object discriminated by `kind`.
 * - `{ nullable }` — `null`, or a value of that shape.
 * - `{ inputs }` — a plain object discriminated by which one of the named fields it has.
 */
export type Shape =
  | "scalar"
  | "bytes"
  | { readonly fields: Readonly<Record<string, Shape>> }
  | { readonly list: Shape }
  | { readonly variants: Readonly<Record<string, Readonly<Record<string, Shape>>>> }
  | { readonly nullable: Shape }
  | { readonly inputs: Readonly<Record<string, Readonly<Record<string, Shape>>>> };

const ENVELOPE = { kind: "scalar", operationId: "scalar", expiresAt: "scalar" } as const;

const ZONE: Shape = { fields: { id: "scalar", kind: "scalar" } };

const PLACEMENT: Shape = {
  variants: {
    Seated: { kind: "scalar", position: "scalar" },
    Unseated: { kind: "scalar", discriminator: "scalar" },
  },
};

const POLICY: Shape = {
  variants: {
    Single: { kind: "scalar" },
    Multiple: { kind: "scalar", max: "scalar", until: "scalar" },
    Unlimited: { kind: "scalar", until: "scalar" },
  },
};

const RESTRICTIONS: Shape = { fields: { cannotResale: "scalar", cannotTransfer: "scalar" } };

/** The fields each V0 command kind may carry: the SDK's `Command` union, and nothing else. */
export const COMMAND_FIELDS = {
  createEvent: {
    ...ENVELOPE,
    event: "scalar",
    salt: "bytes",
    zones: { list: ZONE },
    capacity: "scalar",
    metadata: "scalar",
  },
  setEventStatus: { ...ENVELOPE, event: "scalar", status: "scalar" },
  setEventCapacity: { ...ENVELOPE, event: "scalar", capacity: "scalar", proof: "scalar" },
  addZone: { ...ENVELOPE, event: "scalar", zone: ZONE },
  removeZone: { ...ENVELOPE, event: "scalar", zone: "scalar" },
  issueTicket: {
    ...ENVELOPE,
    event: "scalar",
    ticket: "scalar",
    zone: "scalar",
    placement: PLACEMENT,
    class: "scalar",
    provenance: "scalar",
    policy: POLICY,
    restrictions: RESTRICTIONS,
    holder: "scalar",
    metadata: "scalar",
  },
  transferTicket: { ...ENVELOPE, event: "scalar", ticket: "scalar", receiver: "scalar" },
  removeRestriction: { ...ENVELOPE, event: "scalar", ticket: "scalar", restriction: "scalar" },
  registerCredential: { ...ENVELOPE, account: "scalar", registration: "bytes" },
} as const satisfies Readonly<Record<CommandKind, Readonly<Record<string, Shape>>>>;

const COMMAND: Shape = { variants: COMMAND_FIELDS };

const PASS: Shape = {
  fields: {
    ticket: "scalar",
    holder: "scalar",
    id: "scalar",
    notBefore: "scalar",
    notAfter: "scalar",
  },
};

/** A signed command, or a signed access pass, told apart by which of the two it carries. */
const INPUT: Shape = {
  inputs: {
    command: { command: COMMAND, authorisation: "bytes" },
    pass: { pass: PASS, authorisation: "bytes" },
  },
};

const RECORD_FIELDS: Readonly<Record<string, Shape>> = {
  sequence: "scalar",
  event: { nullable: { fields: { id: "scalar", sequence: "scalar" } } },
  recordedAt: "scalar",
  input: INPUT,
  presentedAt: "scalar",
  prevHash: "scalar",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkFields(value: unknown, fields: Readonly<Record<string, Shape>>, path: string): void {
  if (!isPlainObject(value)) throw new LogContentError(path, "expected a plain object");
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new LogContentError(path, "symbol-keyed properties are not allowed");
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const shape = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (shape === undefined) {
      throw new LogContentError(`${path}.${key}`, "field not in the NFR-6 allow-list");
    }
    check(value[key], shape, `${path}.${key}`);
  }
}

function check(value: unknown, shape: Shape, path: string): void {
  if (shape === "scalar") {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
    throw new LogContentError(path, "expected a scalar value");
  }
  if (shape === "bytes") {
    if (value instanceof Uint8Array) return;
    throw new LogContentError(path, "expected bytes");
  }
  if ("fields" in shape) {
    checkFields(value, shape.fields, path);
    return;
  }
  if ("list" in shape) {
    if (!Array.isArray(value)) throw new LogContentError(path, "expected a list");
    // An array carries its items and nothing else: no named properties hung on it.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)) {
        throw new LogContentError(`${path}.${key}`, "field not in the NFR-6 allow-list");
      }
    }
    value.forEach((item, index) => {
      check(item, shape.list, `${path}[${index}]`);
    });
    return;
  }
  if ("nullable" in shape) {
    if (value !== null) check(value, shape.nullable, path);
    return;
  }
  if (!isPlainObject(value)) throw new LogContentError(path, "expected a plain object");
  if ("inputs" in shape) {
    const present = Object.keys(shape.inputs).filter((name) => Object.hasOwn(value, name));
    const fields = present.length === 1 ? shape.inputs[present[0] as string] : undefined;
    if (fields === undefined) {
      throw new LogContentError(path, "expected a signed command or a signed access pass");
    }
    checkFields(value, fields, path);
    return;
  }
  const kind = value.kind;
  const fields =
    typeof kind === "string" && Object.hasOwn(shape.variants, kind)
      ? shape.variants[kind]
      : undefined;
  if (fields === undefined) {
    throw new LogContentError(`${path}.kind`, `kind ${String(kind)} not in the NFR-6 allow-list`);
  }
  checkFields(value, fields, path);
}

/**
 * Throws `LogContentError` unless every field of the record is in the `NFR-6`
 * allow-list. Values are not validated here — the codec does that — only which
 * fields exist.
 */
export function checkRecordContent(record: unknown): void {
  checkFields(record, RECORD_FIELDS, "record");
}
