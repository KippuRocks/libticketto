import { AssetId, Balance, FileLike, FileLocation } from "./primitives.ts";

export type AccountId = string;

export type Account<File extends FileLike = FileLocation> = {
  id: AccountId;
  identity?: AccountIdentity;
  balance: AccountBalance;
  assets: Record<AssetId, AssetBalance>;
};

export type AccountBalance = {
  free: Balance;
  reserved: Balance;
  frozen: Balance;
};

export type AssetBalance = {
  assetId: AssetId;
  balance: Balance;
};

export type AccountIdentity = {
  display: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  image?: File;
  additional: IdentityAdditionalField[];
};

export type IdentityAdditionalField = [string, string];
