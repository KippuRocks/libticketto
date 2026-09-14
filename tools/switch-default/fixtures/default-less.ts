// Fixture: a default-less exhaustive switch over Command kinds. switch-default
// must reject it.
import type { Command } from "@ticketto/sdk";

export function describeCommand(command: Command): string {
  switch (command.kind) {
    case "createEvent":
      return "create";
    case "setEventStatus":
    case "setEventCapacity":
    case "addZone":
    case "removeZone":
      return "event";
    case "issueTicket":
    case "transferTicket":
    case "removeRestriction":
      return "ticket";
    case "registerCredential":
      return "credential";
  }
}
