// `registerCredential` — features/008-ledger-rules/plan.md §5.2, §5.7a; SPEC.md
// REQ-CP-6, REQ-SP-1.

import type { RegisterCredential } from "@ticketto/sdk";
import { accept, type CommandHandler, reject } from "../handler.js";
import { error } from "../result.js";

/**
 * Registers a credential to an account. Step 3 has already established that the
 * signer is either a credential registered to its account, or — for an account
 * with none — the very credential being registered. Checks, in order:
 * 1. the signer is the account registered to (`ERR-InvalidAuthorisation`): a
 *    credential of one account never adds a device to another;
 * 2. the registration is valid and names that account (`ERR-InvalidAuthorisation`).
 *
 * The first registration creates the account. A credential already registered
 * to the account — the same credential id — is an accepted command that changes
 * no state (plan §5.7a): the stored registration is kept, and the command is
 * logged like any other.
 */
export const registerCredential: CommandHandler<RegisterCredential> = async ({
  tx,
  profile,
  command,
  signer,
}) => {
  if (signer !== command.account) {
    return reject(
      error("ERR-InvalidAuthorisation", "only the account's own credential registers to it"),
    );
  }
  const named = profile.registrationAccount(command.registration);
  if (!named.ok) return reject(error("ERR-InvalidAuthorisation", named.error.detail));
  if (named.value.account !== command.account) {
    return reject(error("ERR-InvalidAuthorisation", "the registration names a different account"));
  }
  const { credential } = named.value;
  const registrations = await tx.getRegistrations(command.account);
  if (registrations.some((r) => r.credential === credential)) {
    return accept(async () => {});
  }
  return accept(async () => {
    await tx.addRegistration(command.account, {
      credential,
      registration: command.registration,
    });
  });
};
