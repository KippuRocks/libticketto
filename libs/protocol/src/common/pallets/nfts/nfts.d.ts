import { AccountId } from "@ticketto/types/account";
import { Balance } from "@ticketto/types/primitives";
import type {
  CollectionId,
  ItemId,
  NftEvent,
  CollectionDetails,
  ItemDetails,
} from "./types.ts";

export interface PalletNfts {
  /**
   * The collections owned by any given account; set out this way so that collections owned by
   * a single account can be enumerated.
   *
   * @param owner The accountId representing the nft owner
   * @param collectionId The ID of the collection to query into
   *
   * @returns A list of tuples, each one containing the owner and collectionId
   */
  collectionAccount(
    owner: AccountId,
    collectionId?: CollectionId
  ): Promise<[AccountId, CollectionId][]>;

  /**
   * The items held by any given account; set out this way so that items owned by a single
   * account can be enumerated.
   *
   * @param owner The accountId representing the nft owner
   * @param collectionId The ID of the collection to query into
   *
   * @returns A list of tuples, each one containing the owner, collectionId and itemId
   */
  account(
    owner: AccountId,
    collection?: CollectionId
  ): Promise<[AccountId, CollectionId, ItemId][]>;

  collection(id: CollectionId): Promise<CollectionDetails<AccountId, Balance>>;

  /**
   * Metadata of a collection.
   *
   * @param id The ID of the collection
   */
  collectionMetadataOf(id: CollectionId): Promise<Uint8rray>;

  item(collectionId: CollectionId, id: ItemId): Promise<ItemDetails<AccountId>>;

  /**
   *
   *
   * @param collectionId
   * @param id
   */
  itemMetadataOf(collectionId: CollectionId, id: ItemId): Promise<Uint8rray>;

  /**
   * Issue a new collection of non-fungible items from a public origin.
   *
   * This new collection has no items initially and its owner is the origin.
   *
   * The origin must be Signed and the sender must have sufficient funds free.
   *
   * @param admin The admin of this collection. The admin is the initial address of each member of the collection's admin team
   * @param config The configuration of this collection.
   */
  create(
    admin: AccountId,
    config: CollectionConfigForNfts
  ): Promise<NftEvent.Created>;

  mint(): Promise<NftEvent.Issued>;
}
