import { Account, AccountId, AccountIdentity } from "@ticketto/types";

export interface DirectoryCalls {
  /**
   * Registers a new acccount
   * @param accountId The {@link AccountId} to insert
   * @param identity The initial identity for the new {@link Account}
   */
  insert(accountId: AccountId, identity: AccountIdentity): Promise<void>;

  /**
   * Sets the identity of an account
   * @param accountId The {@link AccountId} for the account to set the identity
   * @param identity The fields of {@link AccountIdentity} to update
   */
  setIdentity(
    accountId: AccountId,
    identity: Partial<AccountIdentity>
  ): Promise<void>;
}
