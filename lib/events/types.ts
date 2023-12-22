import { AssetCode, AssetId, Balance } from "../primitives/types";

export type Event = {
  id: string;
  name: string;
  description: string;
  banner: string | URL;
  dates: EventDate[];
  price: EventPrice;
};

export type EventDate = {
  startsAt: EpochTimeStamp;
  endsAt: EpochTimeStamp;
};

export type EventPrice = {
  asset: {
    id: AssetId;
    code: AssetCode;
    decimals: number;
  };
  amounts: {
    ticket: Balance;
  };
};
