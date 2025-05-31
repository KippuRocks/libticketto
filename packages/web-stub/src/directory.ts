import { Account, AccountId, AccountIdentity } from "@ticketto/types";

import { DirectoryCalls, DirectoryStorage } from "@ticketto/protocol";
import { IDBPDatabase } from "idb";
import { TickettoDBSchema } from "./types.ts";
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
    return this.db.getAll("accounts");
  }

  indexByDisplay(display: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "accounts",
      "display",
      IDBKeyRange.bound(...boundedByString(display))
    );
  }

  indexByPhone(phone: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "accounts",
      "phone",
      IDBKeyRange.bound(...boundedByString(phone))
    );
  }

  indexByEmail(email: string): Promise<Account[]> {
    return this.db.getAllFromIndex(
      "accounts",
      "email",
      IDBKeyRange.bound(...boundedByString(email))
    );
  }

  get(accountId: AccountId): Promise<Account | undefined> {
    return this.db.get("accounts", accountId);
  }
}

@injectable()
export class WebStubDirectoryCalls implements DirectoryCalls {
  insert(accountId: AccountId, identity: AccountIdentity): Promise<void> {
    throw new Error("Method not implemented.");
  }

  setIdentity(
    accountId: AccountId,
    identity: Partial<AccountIdentity>
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
