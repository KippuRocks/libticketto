import { Balance, BlockNumber } from "@ticketto/types/primitives";

import { AccountId } from "@ticketto/types/account";

export type CollectionId = number;
export type ItemId = number;

export class CollectionSettings {}

export type CollectionConfigFor = {
  settings: CollectionSettings;
};

export namespace NftEvent {
  export type Created = {
    collection: CollectionId;
    creator: AccountId;
    owner: AccountId;
  };
  export type Issued = {
    collection: CollectionId;
    item: ItemId;
    owner: AccountId;
  };
}

export type CollectionDetails<AccountId, DepositBalance> = {
  owner: AccountId;
  ownerDeposit: DepositBalance;
  items: number;
  itemMetadatas: number;
  itemConfigs: number;
  attributes: number;
};

export type ItemDetails<
  AccountId,
  Deposit = ItemDeposit<Balance, AccountId>,
  Approvals = Map<AccountId, BlockNumber>
> = {
  owner: AccountId;
  approvals: Approvals;
  deposit: Deposit;
};

export type ItemDeposit<DepositBalance, AccountId> = {
  account: AccountId;
  amount: DepositBalance;
};
