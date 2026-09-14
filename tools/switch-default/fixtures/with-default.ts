// Fixture: switches over Command kinds and TickettoErrorCode that keep a
// default, and a switch over something else. switch-default must accept them.
import type { Command, TickettoErrorCode } from "@ticketto/sdk";

export function describeCommand(command: Command): string {
  switch (command.kind) {
    case "createEvent":
      return "create";
    default:
      return "other";
  }
}

export function retryable(code: TickettoErrorCode): boolean {
  switch (code) {
    case "ERR-LedgerUnavailable":
      return true;
    default:
      return false;
  }
}

export function state(value: "submitted" | "settled"): number {
  switch (value) {
    case "submitted":
      return 0;
    case "settled":
      return 1;
  }
}
