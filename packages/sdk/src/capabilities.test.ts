/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AccountId,
  Authorisation,
  Command,
  CredentialId,
  EventId,
  Profile,
  Registration,
  Result,
  SignedAccessPass,
  SignedCommand,
  Signer,
  Sponsor,
  Sponsorship,
} from "./index.js";

// REQ-CP-2: no profile-specific type, scheme name, key length or encoding in
// the SDK surface. Names are read from the package's sources with comments
// removed: every identifier and string literal, split into words.

const FORBIDDEN_WORDS = new Set([
  "key",
  "keys",
  "pubkey",
  "privkey",
  "curve",
  "curves",
  "scheme",
  "schemes",
  "seed",
  "mnemonic",
  "ecdsa",
  "eddsa",
  "schnorr",
  "rsa",
  "bls",
  "webauthn",
  "passkey",
  "passkeys",
  "fido",
  "cose",
  "scale",
  "cbor",
]);
const FORBIDDEN_FRAGMENTS = ["ed25519", "sr25519", "secp256", "p256", "blake2", "sha256", "keccak"];

/** Words in `source`'s identifiers and string literals that name a scheme, key or curve. */
function forbiddenNames(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const names = code.match(/[A-Za-z_$][\w$-]*/g) ?? [];
  const found = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const fragment of FORBIDDEN_FRAGMENTS) if (lower.includes(fragment)) found.add(name);
    const words = name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
    for (const word of words) if (FORBIDDEN_WORDS.has(word.toLowerCase())) found.add(name);
  }
  return [...found].sort();
}

function sources(): { file: string; text: string }[] {
  const dir = import.meta.dirname;
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
}

describe("REQ-CP-2: no scheme, key or curve in the surface", () => {
  it("catches such a name when one appears", () => {
    expect(
      forbiddenNames(
        "export interface Ed25519Signer { publicKey: Uint8Array; curve: P256Curve } // a key",
      ),
    ).toEqual(["Ed25519Signer", "P256Curve", "curve", "publicKey"]);
    expect(forbiddenNames('export type Kind = "webauthn-assertion";')).toEqual([
      "webauthn-assertion",
    ]);
  });

  it("finds none in the SDK's sources", () => {
    const found = sources().flatMap(({ file, text }) =>
      forbiddenNames(text).map((name) => `${file}: ${name}`),
    );
    expect(found).toEqual([]);
  });
});

describe("interfaces the SDK consumes (plan §5.7)", () => {
  it("keeps authorisations, registrations and sponsorships opaque, distinct bytes", () => {
    expectTypeOf<Authorisation>().toExtend<Uint8Array>();
    expectTypeOf<Registration>().toExtend<Uint8Array>();
    expectTypeOf<Sponsorship>().toExtend<Uint8Array>();
    // @ts-expect-error — plain bytes are not an authorisation.
    const bytes: Authorisation = new Uint8Array();
    // @ts-expect-error — a sponsorship is not an authorisation.
    const sponsorship: Authorisation = new Uint8Array() as Sponsorship;
    expect([bytes, sponsorship]).toHaveLength(2);
  });

  it("brands a credential id as a string", () => {
    expectTypeOf<CredentialId>().toExtend<string>();
    // @ts-expect-error — an account is not a credential.
    const credential: CredentialId = "00" as AccountId;
    expect(credential).toBeDefined();
  });

  it("derives identifiers and verifies through the profile", () => {
    expectTypeOf<Profile["eventId"]>().toEqualTypeOf<
      (creator: AccountId, salt: Uint8Array) => EventId
    >();
    expectTypeOf<Profile["encodeCommand"]>().parameter(0).toEqualTypeOf<Command>();
    expectTypeOf<ReturnType<Profile["accountOf"]>>().toEqualTypeOf<
      Result<{ readonly account: AccountId; readonly credential: CredentialId }>
    >();
    expectTypeOf<Profile["verify"]>().parameters.toEqualTypeOf<
      [registration: Registration, payload: Uint8Array, authorisation: Authorisation]
    >();
    expectTypeOf<ReturnType<Profile["decodePass"]>>().toEqualTypeOf<Result<SignedAccessPass>>();
  });

  it("signs asynchronously for one account, and sponsors a signed command", () => {
    expectTypeOf<Signer["account"]>().toEqualTypeOf<AccountId>();
    expectTypeOf<ReturnType<Signer["sign"]>>().toEqualTypeOf<Promise<Authorisation>>();
    expectTypeOf<Sponsor["sponsor"]>().parameter(0).toEqualTypeOf<SignedCommand>();
    expectTypeOf<ReturnType<Sponsor["sponsor"]>>().toEqualTypeOf<Promise<Result<Sponsorship>>>();
  });
});
