import { Account, AccountId } from "@ticketto/types";

export interface DirectoryStorage {
  /**
   * Returns the list of all existing accounts.
   */
  all(): Promise<Account[]>;

  /**
   * Returns this list of accounts, indexed by display.
   * @param display A nickname to display quickly identifying an account.
   */
  indexByDisplay(display: string): Promise<Account[]>;

  /**
   * Returns this list of accounts, indexed by phone.
   * @param phone The phone number of the {@link Account}.
   */
  indexByPhone(phone: string): Promise<Account[]>;

  /**
   * Returns this list of accounts, indexed by email.
   * @param email The email of the {@link Account}.
   */
  indexByEmail(email: string): Promise<Account[]>;

  /**
   * Returns an account by its ID. Returns undefined if no account is found.
   * @param accountId The {@link AccountId} that identifies an {@link Account}.
   */
  get(accountId: AccountId): Promise<Account | undefined>;
}
