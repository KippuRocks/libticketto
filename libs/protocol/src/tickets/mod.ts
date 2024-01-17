import { AccountId } from "@ticketto/types/account";
import { CollectionId } from "../common/pallets/nfts/types.js";
import { IPFS } from "../storage/ipfs.js";
import { PalletNfts } from "../common/pallets/nfts/nfts.js";

export interface Config {
  nfts: PalletNfts;
  storage: IPFS;
}

export class TicketsModule {
  constructor(private config: Config) {}

  async list(owner: AccountId, eventIds: CollectionId[]) {
    const items = await Promise.all(
      eventIds.map((eventId) => this.config.nfts.account(owner, eventId))
    ).then((itemsWithinCollections) => itemsWithinCollections.flat());

    return Promise.all(
      items.map(async ([_, collection, item]) => {
        const itemMetadata = await this.config.nfts.itemMetadataOf(
          collection,
          item
        );
        const metadataFile = await this.config.storage.get(itemMetadata);
      })
    );
  }
}
