import { Account, AccountId, AccountIdentity } from "@ticketto/types";

import { DirectoryCalls, DirectoryStorage } from "@ticketto/protocol";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema, zero } from "./types.ts";
import { inject, injectable } from "inversify";

function boundedByString(s: string): [string, string] {
  const inc = (s: string) =>
    s === "" ? "" : String.fromCharCode(s.charCodeAt(0) + 1);

  const letters = s.split("");
  const lastChar = letters.pop();

  return [s, letters.concat(inc(lastChar ?? "")).join("")];
}

@injectable()
export class WebStubDirectoryStorage implements DirectoryStorage {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) {}

  all(): Promise<Account[]> {
    return this.db.getAll("Accounts");
  }

  indexByDisplay(display: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "Accounts",
      "display",
      IDBKeyRange.bound(...boundedByString(display))
    );
  }

  indexByPhone(phone: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "Accounts",
      "phone",
      IDBKeyRange.bound(...boundedByString(phone))
    );
  }

  indexByEmail(email: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "Accounts",
      "email",
      IDBKeyRange.bound(...boundedByString(email))
    );
  }

  get(accountId: AccountId): Promise<Account | undefined> {
    return this.db.get("Accounts", accountId);
  }
}

@injectable()
export class WebStubDirectoryCalls implements DirectoryCalls {
  constructor(
    @inject("TickettoDB") private db: IDBPDatabase<TickettoDBSchema>
  ) {}

  async insert(id: AccountId, identity: AccountIdentity) {
    await this.db.put("Accounts", {
      id,
      identity,
      balance: zero,
      assets: {},
    });
  }

  async setIdentity(accountId: AccountId, identity: Partial<AccountIdentity>) {
    const account = await this.db.get("Accounts", accountId);
    if (account == undefined) {
      throw new Error("AccountNotFound");
    }
    Object.defineProperty(account, "identity", {
      value: { ...(account.identity ?? {}), ...identity },
    });
    await this.db.put("Accounts", account);
  }
}
