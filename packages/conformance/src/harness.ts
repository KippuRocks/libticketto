// The conformance harness — features/004-conformance/plan.md §5.1, REQ-SDK-7, REQ-CP-5.
//
// The suite is written once, against the SDK surface (C1) and the backend port
// (C8) only. A run injects the three things that vary: a backend, a
// cryptographic profile, and the signers that profile needs. The matrix is
// profiles × backends; nothing in a suite may name either.

import type {
  Backend,
  ClassId,
  Discriminator,
  PassId,
  Position,
  Profile,
  ProofId,
  Registration,
  Signer,
  Sponsor,
  Timestamp,
  ZoneId,
} from "@ticketto/sdk";

/**
 * A settable clock. The backend's rules read the same clock (`REQ-SDK-3`), so
 * setting or advancing it moves the ledger's current time.
 */
export interface TestClock {
  /** The backend's current time. */
  now(): Timestamp;
  /** Sets the current time. */
  set(time: Timestamp): void;
  /** Moves the current time forward by `ms` milliseconds. */
  advance(ms: number): void;
}

/**
 * What every backend must offer in test mode, and nowhere else (§5.1): a
 * settable clock, seeded randomness, and the gate parameters its rules use
 * (§5.2b). For a service, test mode is a flag that production refuses to start
 * with.
 */
export interface TestControls {
  readonly clock: TestClock;
  /**
   * Random bytes from a seeded source, for operation and pass ids. Two backends
   * made by the same `makeBackend` yield the same sequence, so a failing run can
   * be replayed.
   */
  randomBytes(length: number): Uint8Array;
  /**
   * How long after a pass's `notAfter` the backend still records it, in
   * milliseconds (`AD-13`; `features/008-ledger-rules/plan.md` §5.6).
   */
  readonly maxRecordingLag: number;
  /**
   * How far ahead of the backend's clock a pass's `presentedAt` may be, in
   * milliseconds; beyond it the pass fails with `ERR-PassExpired`.
   */
  readonly maxClockSkew: number;
  /**
   * The longest window, `notAfter − notBefore`, a pass may carry, in
   * milliseconds; a longer one fails with `ERR-PassExpired`.
   */
  readonly maxPassWindow: number;
}

/** A backend in test mode. */
export type TestBackend = Backend & TestControls;

/** A signer together with the registration that registers its credential (`REQ-CP-6`). */
export interface Credential {
  readonly signer: Signer;
  readonly registration: Registration;
}

/**
 * The signers a run needs, produced by the profile under test (`REQ-CP-5`).
 * Each signs the profile's signing payloads — `Profile.encodeCommand` and
 * `Profile.encodePass` output — never raw encodings.
 */
export interface ConformanceSigners {
  /** Organiser authority (`REQ-OA-1`). Registered in every fresh world. */
  readonly organiser: Credential;
  /** Holders, each a distinct account. Registered in every fresh world. At least three. */
  readonly holders: readonly Credential[];
  /** A further credential for `holders[0]`'s account — a second device (`REQ-CP-6`). Not registered. */
  readonly secondDevice: Credential;
  /** A credential for an account no fresh world registers. */
  readonly stranger: Credential;
  /** Relays and bears the cost of every submission (`REQ-SP-1`). */
  readonly sponsor: Sponsor;
}

/**
 * Well-formed identifier values under the profile under test. Their widths and
 * encodings are the profile's (`REQ-CP-1`), so the suite never invents them.
 * Equal indices give equal values; distinct indices give distinct values.
 */
export interface ConformanceIdentifiers {
  zone(index: number): ZoneId;
  class(index: number): ClassId;
  position(index: number): Position;
  discriminator(index: number): Discriminator;
  proof(index: number): ProofId;
  /** An access pass id (`REQ-AP-4`). */
  pass(index: number): PassId;
  /** A salt for `createEvent` (`REQ-EV-9`). */
  salt(index: number): Uint8Array;
}

/** One cell of the conformance matrix: a backend under one profile. */
export interface ConformanceTarget {
  /** Names the cell, for example `backend-memory × profile-v0`. */
  readonly name: string;
  /** A fresh, empty backend in test mode. Called once per test. */
  readonly makeBackend: () => Promise<TestBackend>;
  readonly profile: Profile;
  readonly signers: ConformanceSigners;
  readonly identifiers: ConformanceIdentifiers;
}

/** The fixtures a profile contributes to a target: everything but the backend. */
export type ProfileFixtures = Pick<ConformanceTarget, "profile" | "signers" | "identifiers">;
