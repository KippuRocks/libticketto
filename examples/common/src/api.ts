import { ApiPromise, WsProvider } from "@polkadot/api";
import {
  CheckinCall,
  CheckinEvent,
  ClaimTransferCall,
  CollectionId,
  ItemId,
  TicketCall,
  TicketEvent,
  TicketPallet,
  Timestamp,
} from "@ticketto/types/chain";

export async function createApi() {
  const provider = new WsProvider("wss://rococo-asset-hub-rpc.polkadot.io");
  return ApiPromise.create({
    provider,
    types: {
      CollectionId,
      ItemId,
      Timestamp,

      TicketPallet,
      TicketEvent,
      CheckinEvent,
      TicketCall,
      CheckinCall,
      ClaimTransferCall,
    },
  });
}
