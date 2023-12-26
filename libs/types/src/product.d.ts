import type { AssetCode, AssetId, Balance } from "./primitives.d.ts";

export type LineItem = {
  description: string;
  price: LineItemPrice;
};

export type LineItemPrice = {
  asset: {
    id: AssetId;
    code: AssetCode;
    decimals: number;
  };
  amount: Balance;
};
