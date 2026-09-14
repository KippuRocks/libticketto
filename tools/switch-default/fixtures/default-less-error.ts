// Fixture: a default-less switch over TickettoErrorCode. switch-default must
// reject it.
import type { TickettoErrorCode } from "@ticketto/sdk";

export function retryable(code: TickettoErrorCode): boolean {
  switch (code) {
    case "ERR-LedgerUnavailable":
      return true;
    case "ERR-OperationExpired":
      return false;
  }
  return false;
}
