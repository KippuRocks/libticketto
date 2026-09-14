import type {
  Command,
  CommandKind,
  Discriminator,
  EventId,
  SignedAccessPass,
  SignedCommand,
  ZoneId,
} from "@ticketto/sdk";
import type { ChainedRecord, LogInput } from "../src/index.js";
export declare const organiser: import("@ticketto/profile-v0/testing").SoftwareP256Credential;
export declare const holder: import("@ticketto/profile-v0/testing").SoftwareP256Credential;
export declare const salt: Uint8Array<ArrayBufferLike>;
export declare const event: EventId;
export declare const zone: ZoneId;
export declare const placement: {
  readonly kind: "Unseated";
  readonly discriminator: Discriminator;
};
export declare const ticket: import("@ticketto/sdk").TicketId;
/** One command of every V0 kind, in the SDK's order. */
export declare const COMMANDS: Readonly<Record<CommandKind, Command>>;
export declare function signCommand(command: Command): Promise<SignedCommand>;
export declare function samplePass(): Promise<SignedAccessPass>;
/** The event reference a record of `input` carries, at `sequence` in that event. */
export declare function eventOf(input: LogInput, sequence: number): ChainedRecord["event"];
//# sourceMappingURL=fixtures.d.ts.map
