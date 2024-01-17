import type { TicketPalletEnum } from "./chain.types.d.ts";

/**
 * The magic number (UTF-8 encoded kanjis for _kippu_: 切符) used to
 * determine whether a message passed on-chain is related to ticketto
 * protocol.
 */
export const magicNumber = new Uint8Array([0xe5, 0x88, 0x87, 0xe7, 0xac, 0xa6]);

/**
 * A definition of the ticket pallet
 */
export const TicketPallet = {
  _enum: {
    Event: "TicketEvent",
    Call: "TicketCall",
  } as TicketPalletEnum,
};

/** Unsigend 32-bit number representing the ID of a collection (i.e. an event) */
export const CollectionId = "u32";
/** Unsigend 32-bit number representing the ID of an item (i.e. a ticket) */
export const ItemId = "u32";
/** Unsigend 64-bit number representing a UNIX epoch */
export const Timestamp = "u64";

/// Events

export const TicketEvent = {
  _enum: {
    CheckinConfirmed: "CheckinEvent",
    CheckinRejected: "CheckinEvent",
  },
};

export const CheckinEvent = {
  who: "AccountId",
  ticket: "(CollectionId, ItemId)",
  when: "Timestamp",
};

/// Calls

export const TicketCall = {
  _enum: {
    Checkin: "CheckinCall",
    ClaimTransfer: "ClaimTransferCall",
  },
};

export const CheckinCall = {
  collectionId: "Compact<u32>",
  itemId: "Compact<u32>",
  timestamp: "Compact<Timestamp>",
};

export const ClaimTransferCall = {
  collectionId: "Compact<u32>",
  itemId: "Compact<u32>",
  commitMessage: "Vec<u8>",
};
