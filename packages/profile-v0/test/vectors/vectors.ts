// T-003-08 — the `C2` test vectors (REQ-CP-5, REQ-SDK-4; plan §5.5).
//
// `buildVectors` generates them deterministically; `vectors/v0.json` is its
// checked-in output. `vectorsSuite` checks that the file is what the current
// codecs generate (so a codec change without regenerated vectors fails CI), and
// reproduces every vector from its inputs alone — what `binding-offchain`,
// `ticketto-offchain` and any other implementation must also do.
//
// Byte strings are lower-case hex throughout.

import type {
  AccessPass,
  AccountId,
  Authorisation,
  Command,
  Discriminator,
  EventId,
  PassId,
  Placement,
  Position,
  Registration,
  SignedAccessPass,
  SignedCommand,
  ZoneId,
} from "@ticketto/sdk";
import { concatBytes, fromHex, toHex } from "../../src/bytes.js";
import { COMMAND_INDEX, decodeCommand, encodeCommand } from "../../src/codec/command.js";
import { FORMAT_VERSION } from "../../src/codec/scale.js";
import { encodeAuthorisation, encodeRegistration } from "../../src/credential/credential.js";
import { webAuthnChallenge } from "../../src/credential/webauthn.js";
import {
  blake2b256,
  deviceId,
  eventId,
  hashedUserId,
  holderAccountId,
  p256AccountId,
  ticketId,
} from "../../src/derive.js";
import {
  decodePass,
  encodePass,
  encodeSignedPass,
  passSigningPayload,
  verifyPass,
} from "../../src/pass.js";
import { createProfileV0 } from "../../src/profile.js";
import {
  decodeSignedAccessPass,
  decodeSignedCommand,
  encodeSignedAccessPass,
  encodeSignedCommand,
} from "../../src/signed-input.js";
import {
  COMMAND_SIGNING_TAG,
  commandSigningPayload,
  PASS_SIGNING_TAG,
  registrationChallenge,
} from "../../src/signing.js";
import { simulatedWebAuthnSigner, softwareP256Signer } from "../../src/testing/signers.js";
import { assert, assertEqual, type Suite } from "../harness.js";
import { p256Key } from "../keys.js";
import { Random } from "../random.js";

export const RP_ID = "kippu.example";
const T0 = 1_760_000_000_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A command as JSON: its byte-string fields as hex. */
function commandToJson(command: Command): Json {
  return JSON.parse(
    JSON.stringify(command, (_key, value) => (value instanceof Uint8Array ? toHex(value) : value)),
  ) as Json;
}

/** The command a JSON vector describes. */
export function commandFromJson(json: Record<string, unknown>): Command {
  if (json.kind === "createEvent")
    return { ...json, salt: fromHex(json.salt as string) } as Command;
  if (json.kind === "registerCredential") {
    return { ...json, registration: fromHex(json.registration as string) } as Command;
  }
  return json as unknown as Command;
}

export async function buildVectors(): Promise<Json> {
  const random = new Random(0x0c2_0000);
  const profile = createProfileV0({ rpId: RP_ID });

  // Identifiers.
  const userIds = ["00".repeat(32), "ff".repeat(32), random.hex<string>(32)];
  const holderAccount = userIds.map((userId) => ({
    userId,
    hashedUserId: toHex(hashedUserId(userId)),
    account: holderAccountId(userId),
    registrationChallenge: toHex(registrationChallenge(holderAccountId(userId))),
  }));
  const p256Account = [0, 1, 2].map(() => {
    const publicKey = softwareP256Signer({ secretKey: p256Key(random).secretKey }).publicKey;
    return { publicKey: toHex(publicKey), account: p256AccountId(publicKey) };
  });
  const deviceIds = [new Uint8Array(0), random.bytes(16), random.bytes(64)].map((rawId) => ({
    rawId: toHex(rawId),
    deviceId: toHex(deviceId(rawId)),
  }));
  const eventIds = [new Uint8Array(0), random.bytes(8), random.bytes(32)].map((salt) => {
    const creator = random.accountId();
    return { creator, salt: toHex(salt), eventId: eventId(creator, salt) };
  });
  const placements: Placement[] = [
    { kind: "Seated", position: "" as Position },
    { kind: "Seated", position: "0a0c" as Position },
    { kind: "Unseated", discriminator: "00".repeat(16) as Discriminator },
    { kind: "Unseated", discriminator: random.hex<Discriminator>(16) },
  ];
  const ticketIds = placements.map((placement) => {
    const event = random.eventId();
    const zone = random.zoneId();
    return {
      event,
      zone,
      placement: placement as unknown as Json,
      ticketId: ticketId(event, zone, placement),
    };
  });

  // Credentials, fixed by seeded keys.
  const organiser = softwareP256Signer({ secretKey: p256Key(random).secretKey });
  const holder = simulatedWebAuthnSigner({
    rpId: RP_ID,
    userId: random.hex<string>(32),
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(32),
  });
  const stranger = simulatedWebAuthnSigner({
    rpId: RP_ID,
    userId: random.hex<string>(32),
    secretKey: p256Key(random).secretKey,
    credentialId: random.bytes(32),
  });
  const credentials = [
    ["organiser", "p256", organiser],
    ["holder", "pass-webauthn", holder],
    ["stranger", "pass-webauthn", stranger],
  ] as const;
  const credentialVectors = credentials.map(([name, kind, credential]) => {
    const registered = profile.registrationAccount(credential.registration);
    if (!registered.ok) throw new Error(`${name} does not register`);
    return {
      name,
      kind,
      registration: toHex(credential.registration),
      account: registered.value.account,
      credential: registered.value.credential,
    };
  });

  // Registrations the profile refuses (plan §5.7, ruling 1).
  const attestedOver = (challenge: Uint8Array) =>
    encodeRegistration({
      kind: "passWebAuthn",
      hashedUserId: hashedUserId(holder.userId),
      attestation: holder.authenticator.attest(challenge),
    });
  const rejectedRegistrations = [
    ["pass-webauthn attestation with a wrong challenge", attestedOver(random.bytes(32))],
    [
      "pass-webauthn attestation over the untagged BLAKE2b-256(account)",
      attestedOver(blake2b256(fromHex(holder.signer.account))),
    ],
    [
      "pass-webauthn attestation over another account's challenge",
      attestedOver(registrationChallenge(stranger.signer.account)),
    ],
  ].map(([name, registration]) => {
    const result = profile.registrationAccount(registration as Registration);
    if (result.ok || result.error.code !== "ERR-InvalidAuthorisation") {
      throw new Error(`registration vector "${name}" is accepted`);
    }
    return {
      name: name as string,
      registration: toHex(registration as Uint8Array),
      result: result.error.code,
    };
  });

  // Commands: two of every kind.
  const commands = (Object.keys(COMMAND_INDEX) as Command["kind"][]).flatMap((kind) =>
    [0, 1].map((n) => {
      const command = random.command(kind);
      return {
        name: `${kind}-${n}`,
        command: commandToJson(command),
        bytes: toHex(encodeCommand(command)),
        signingPayload: toHex(commandSigningPayload(command)),
      };
    }),
  );

  // Authorisations over command signing payloads, valid and invalid.
  const signedCommand = random.command("transferTicket");
  const commandBytes = encodeCommand(signedCommand);
  const payload = profile.encodeCommand(signedCommand);
  const byOrganiser = await organiser.signer.sign(payload);
  const byHolder = await holder.signer.sign(payload);
  const asPass = concatBytes(PASS_SIGNING_TAG, commandBytes);
  const crossPass: AccessPass = {
    ticket: random.ticketId(),
    holder: holder.signer.account,
    id: random.hex<PassId>(16),
    notBefore: T0,
    notAfter: T0 + 60_000,
  };
  const passAsCommand = concatBytes(COMMAND_SIGNING_TAG, encodePass(crossPass));
  const passByOrganiser = await organiser.signer.sign(passSigningPayload(crossPass));
  const passByHolder = await holder.signer.sign(passSigningPayload(crossPass));
  const tampered = payload.slice();
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
  const authorisations = [
    ["p256 valid", organiser.registration, payload, byOrganiser, true],
    ["p256 over a tampered payload", organiser.registration, tampered, byOrganiser, false],
    ["p256 against another registration", holder.registration, payload, byOrganiser, false],
    [
      "p256 over the untagged command bytes",
      organiser.registration,
      commandBytes,
      byOrganiser,
      false,
    ],
    [
      "p256 command signature as a pass signature",
      organiser.registration,
      asPass,
      byOrganiser,
      false,
    ],
    [
      "p256 pass signature as a command signature",
      organiser.registration,
      passAsCommand,
      passByOrganiser,
      false,
    ],
    ["pass-webauthn valid", holder.registration, payload, byHolder, true],
    ["pass-webauthn over a tampered payload", holder.registration, tampered, byHolder, false],
    ["pass-webauthn against another device", stranger.registration, payload, byHolder, false],
    [
      "pass-webauthn over the untagged command bytes",
      holder.registration,
      commandBytes,
      byHolder,
      false,
    ],
    [
      "pass-webauthn command signature as a pass signature",
      holder.registration,
      asPass,
      byHolder,
      false,
    ],
    [
      "pass-webauthn pass signature as a command signature",
      holder.registration,
      passAsCommand,
      passByHolder,
      false,
    ],
    [
      "pass-webauthn with a wrong RP id",
      holder.registration,
      payload,
      simulatedAssertion(holder, payload, { rpId: "evil.example" }),
      false,
    ],
    [
      "pass-webauthn without user presence",
      holder.registration,
      payload,
      simulatedAssertion(holder, payload, { userPresent: false }),
      false,
    ],
    [
      "pass-webauthn without user verification",
      holder.registration,
      payload,
      simulatedAssertion(holder, payload, { userVerified: false }),
      false,
    ],
    [
      "pass-webauthn with type webauthn.create",
      holder.registration,
      payload,
      simulatedAssertion(holder, payload, { type: "webauthn.create" }),
      false,
    ],
  ].map(([name, registration, bytes, authorisation, valid]) => {
    const auth = authorisation as Uint8Array;
    if (
      profile.verify(registration as Registration, bytes as Uint8Array, auth as never) !== valid
    ) {
      throw new Error(`vector "${name}" does not behave as labelled`);
    }
    return {
      name: name as string,
      registration: toHex(registration as Uint8Array),
      payload: toHex(bytes as Uint8Array),
      authorisation: toHex(auth),
      valid: valid as boolean,
    };
  });

  // Access passes.
  const pass: AccessPass = {
    ticket: random.ticketId(),
    holder: holder.signer.account,
    id: random.hex<PassId>(16),
    notBefore: T0,
    notAfter: T0 + 60_000,
  };
  const signed = { pass, authorisation: await holder.signer.sign(passSigningPayload(pass)) };
  const foreignPass = { ...pass, id: random.hex<PassId>(16) };
  const forged = {
    pass: foreignPass,
    authorisation: await stranger.signer.sign(passSigningPayload(foreignPass)),
  };
  const signedPasses = [
    ["valid", signed, holder.registration, T0 + 30_000, "ok"],
    [
      "AC-E1.2 signed by a non-holder",
      forged,
      stranger.registration,
      T0 + 30_000,
      "ERR-InvalidPass",
    ],
    ["ERR-PassExpired after notAfter", signed, holder.registration, T0 + 60_001, "ERR-PassExpired"],
    ["ERR-PassExpired before notBefore", signed, holder.registration, T0 - 1, "ERR-PassExpired"],
  ].map(([name, value, registration, now, result]) => {
    const presented = value as typeof signed;
    const outcome = verifyPass(
      presented,
      registration as Registration,
      { now: () => now as number },
      { rpId: RP_ID },
    );
    if ((outcome.ok ? "ok" : outcome.error.code) !== result)
      throw new Error(`pass vector "${name}" mislabelled`);
    return {
      name: name as string,
      pass: presented.pass as unknown as Json,
      passBytes: toHex(encodePass(presented.pass)),
      signingPayload: toHex(passSigningPayload(presented.pass)),
      bytes: toHex(encodeSignedPass(presented)),
      registration: toHex(registration as Uint8Array),
      now: now as number,
      result: result as string,
    };
  });

  // Signed inputs, framed as the log and the wire protocol carry them.
  const signedInputs: { name: string; input: SignedCommand | SignedAccessPass }[] = [
    {
      name: "command signed by p256",
      input: { command: signedCommand, authorisation: byOrganiser },
    },
    {
      name: "command signed by pass-webauthn",
      input: { command: signedCommand, authorisation: byHolder },
    },
    {
      name: "command with an opaque authorisation",
      input: {
        command: random.command("registerCredential"),
        authorisation: new Uint8Array(0) as Authorisation,
      },
    },
    { name: "access pass signed by pass-webauthn", input: signed },
    {
      name: "access pass signed by p256",
      input: { pass: crossPass, authorisation: passByOrganiser },
    },
  ];
  const signedInputVectors = signedInputs.map(({ name, input }) => {
    const authorisation = toHex(input.authorisation);
    if ("command" in input) {
      return {
        name,
        kind: "command",
        input: { command: commandToJson(input.command), authorisation },
        bytes: toHex(encodeSignedCommand(input)),
      };
    }
    return {
      name,
      kind: "accessPass",
      input: { pass: input.pass as unknown as Json, authorisation },
      bytes: toHex(encodeSignedAccessPass(input)),
    };
  });
  const framedCommand = fromHex(signedInputVectors[0]?.bytes ?? "");
  const framedPass = fromHex(signedInputVectors[3]?.bytes ?? "");

  const signedBytes = encodeSignedPass(signed);
  const malformed = [
    [
      "command with an unknown format version",
      "command",
      concatBytes(Uint8Array.of(1), fromHex(commands[0]?.bytes ?? "").subarray(1)),
    ],
    [
      "command with a trailing byte",
      "command",
      concatBytes(fromHex(commands[0]?.bytes ?? ""), Uint8Array.of(0)),
    ],
    ["signed pass truncated", "pass", signedBytes.subarray(0, signedBytes.length - 1)],
    ["signed pass with a trailing byte", "pass", concatBytes(signedBytes, Uint8Array.of(0))],
    [
      "signed command framing with a trailing byte",
      "signedCommand",
      concatBytes(framedCommand, Uint8Array.of(0)),
    ],
    [
      "signed command framing with an unknown kind",
      "signedCommand",
      concatBytes(Uint8Array.of(0, 2), framedCommand.subarray(2)),
    ],
    ["signed access pass framing read as a signed command", "signedCommand", framedPass],
    [
      "signed access pass framing truncated",
      "signedAccessPass",
      framedPass.subarray(0, framedPass.length - 1),
    ],
    ["signed command framing read as a signed access pass", "signedAccessPass", framedCommand],
  ].map(([name, kind, bytes]) => ({
    name: name as string,
    kind: kind as string,
    bytes: toHex(bytes as Uint8Array),
  }));

  return {
    profile: "ticketto/v0",
    formatVersion: FORMAT_VERSION,
    rpId: RP_ID,
    identifiers: {
      holderAccount,
      p256Account,
      deviceId: deviceIds,
      eventId: eventIds,
      ticketId: ticketIds,
    },
    credentials: credentialVectors,
    rejectedRegistrations,
    commands,
    authorisations,
    signedPasses,
    signedInputs: signedInputVectors,
    malformed,
  } as unknown as Json;
}

function simulatedAssertion(
  credential: ReturnType<typeof simulatedWebAuthnSigner>,
  payload: Uint8Array,
  overrides: { rpId?: string; userPresent?: boolean; userVerified?: boolean; type?: string },
): Uint8Array {
  return encodeAuthorisation({
    kind: "passWebAuthn",
    deviceId: credential.authenticator.deviceId,
    assertion: credential.authenticator.assert(
      hashedUserId(credential.userId),
      webAuthnChallenge(payload),
      overrides,
    ),
  });
}

interface Vectors {
  rpId: string;
  identifiers: {
    holderAccount: {
      userId: string;
      hashedUserId: string;
      account: string;
      registrationChallenge: string;
    }[];
    p256Account: { publicKey: string; account: string }[];
    deviceId: { rawId: string; deviceId: string }[];
    eventId: { creator: string; salt: string; eventId: string }[];
    ticketId: { event: string; zone: string; placement: Placement; ticketId: string }[];
  };
  credentials: { name: string; registration: string; account: string; credential: string }[];
  rejectedRegistrations: { name: string; registration: string; result: string }[];
  commands: {
    name: string;
    command: Record<string, unknown>;
    bytes: string;
    signingPayload: string;
  }[];
  authorisations: {
    name: string;
    registration: string;
    payload: string;
    authorisation: string;
    valid: boolean;
  }[];
  signedPasses: {
    name: string;
    pass: AccessPass;
    passBytes: string;
    signingPayload: string;
    bytes: string;
    registration: string;
    now: number;
    result: string;
  }[];
  signedInputs: {
    name: string;
    kind: "command" | "accessPass";
    input: { command?: Record<string, unknown>; pass?: AccessPass; authorisation: string };
    bytes: string;
  }[];
  malformed: { name: string; kind: string; bytes: string }[];
}

/**
 * Checks `file` — the parsed `vectors/v0.json` — against the current code:
 * it must be exactly what `buildVectors` generates, and every vector must
 * reproduce from its inputs.
 */
export function vectorsSuite(file: unknown): Suite {
  const vectors = file as Vectors;
  return ({ describe, it }) => {
    describe("T-003-08 test vectors", () => {
      it("vectors/v0.json is what the current codecs generate (regenerate with `pnpm vectors:generate`)", async () => {
        assertEqual(await buildVectors(), file, "the checked-in vectors are stale");
      });

      const profile = createProfileV0({ rpId: vectors.rpId });

      it("identifiers reproduce", () => {
        const ids = vectors.identifiers;
        for (const v of ids.holderAccount) {
          assertEqual(toHex(hashedUserId(v.userId)), v.hashedUserId);
          assertEqual(holderAccountId(v.userId), v.account);
          assertEqual(
            toHex(registrationChallenge(v.account as AccountId)),
            v.registrationChallenge,
          );
        }
        for (const v of ids.p256Account)
          assertEqual(p256AccountId(fromHex(v.publicKey)), v.account);
        for (const v of ids.deviceId) assertEqual(toHex(deviceId(fromHex(v.rawId))), v.deviceId);
        for (const v of ids.eventId) {
          assertEqual(profile.eventId(v.creator as AccountId, fromHex(v.salt)), v.eventId);
        }
        for (const v of ids.ticketId) {
          assertEqual(
            profile.ticketId(v.event as EventId, v.zone as ZoneId, v.placement),
            v.ticketId,
          );
        }
      });

      it("credentials name their accounts", () => {
        for (const v of vectors.credentials) {
          const result = profile.registrationAccount(fromHex(v.registration) as Registration);
          assert(result.ok, v.name);
          assertEqual(result.value, { account: v.account, credential: v.credential }, v.name);
        }
      });

      it("registrations with a wrong challenge are refused", () => {
        for (const v of vectors.rejectedRegistrations) {
          const result = profile.registrationAccount(fromHex(v.registration) as Registration);
          assert(!result.ok && result.error.code === v.result, v.name);
        }
      });

      it("commands encode to their bytes and signing payloads, and decode back", () => {
        for (const v of vectors.commands) {
          const command = commandFromJson(v.command);
          assertEqual(toHex(encodeCommand(command)), v.bytes, v.name);
          assertEqual(toHex(profile.encodeCommand(command)), v.signingPayload, v.name);
          assertEqual(
            v.signingPayload,
            toHex(concatBytes(COMMAND_SIGNING_TAG, fromHex(v.bytes))),
            v.name,
          );
          assertEqual(decodeCommand(fromHex(v.bytes)), command, v.name);
        }
      });

      it("authorisations verify, or fail, as labelled", () => {
        for (const v of vectors.authorisations) {
          const verified = profile.verify(
            fromHex(v.registration) as Registration,
            fromHex(v.payload),
            fromHex(v.authorisation) as never,
          );
          assertEqual(verified, v.valid, v.name);
        }
      });

      it("signed passes decode, and verify or fail as labelled", () => {
        for (const v of vectors.signedPasses) {
          assertEqual(toHex(encodePass(v.pass)), v.passBytes, v.name);
          assertEqual(toHex(profile.encodePass(v.pass)), v.signingPayload, v.name);
          const decoded = profile.decodePass(fromHex(v.bytes));
          assert(decoded.ok, v.name);
          assertEqual(decoded.value.pass, v.pass, v.name);
          const result = verifyPass(
            decoded.value,
            fromHex(v.registration) as Registration,
            { now: () => v.now },
            { rpId: vectors.rpId },
          );
          assertEqual(result.ok ? "ok" : result.error.code, v.result, v.name);
        }
      });

      it("signed inputs frame to their bytes, and decode back", () => {
        for (const v of vectors.signedInputs) {
          const authorisation = fromHex(v.input.authorisation) as Authorisation;
          if (v.kind === "command") {
            const signed = {
              command: commandFromJson(v.input.command ?? {}),
              authorisation,
            };
            assertEqual(toHex(encodeSignedCommand(signed)), v.bytes, v.name);
            assertEqual(decodeSignedCommand(fromHex(v.bytes)), { ok: true, value: signed }, v.name);
          } else {
            const signed = { pass: v.input.pass as AccessPass, authorisation };
            assertEqual(toHex(encodeSignedAccessPass(signed)), v.bytes, v.name);
            assertEqual(
              decodeSignedAccessPass(fromHex(v.bytes)),
              { ok: true, value: signed },
              v.name,
            );
          }
        }
      });

      it("malformed bytes are refused", () => {
        for (const v of vectors.malformed) {
          if (v.kind === "pass") {
            const result = decodePass(fromHex(v.bytes));
            assert(!result.ok && result.error.code === "ERR-InvalidPass", v.name);
          } else if (v.kind === "signedCommand") {
            const result = decodeSignedCommand(fromHex(v.bytes));
            assert(!result.ok && result.error.code === "ERR-InvalidAuthorisation", v.name);
          } else if (v.kind === "signedAccessPass") {
            const result = decodeSignedAccessPass(fromHex(v.bytes));
            assert(!result.ok && result.error.code === "ERR-InvalidPass", v.name);
          } else {
            let refused = false;
            try {
              decodeCommand(fromHex(v.bytes));
            } catch {
              refused = true;
            }
            assert(refused, v.name);
          }
        }
      });
    });
  };
}
