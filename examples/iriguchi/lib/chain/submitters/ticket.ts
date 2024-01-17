import type { EventId, TicketId } from "@ticketto/types";

import { ApiPromise } from "@polkadot/api";
import { Submitter } from "./base.js";
import type { TicketEvent } from "@ticketto/types/chain.types.d";

export class TicketSubmitter extends Submitter {
  constructor(private api: ApiPromise) {
    super(api);
  }

  checkin(collectionId: EventId, itemId: TicketId, timestamp: number) {
    return this.createExtrinsic(
      this.api
        .createType("TicketPallet", {
          Call: {
            Checkin: {
              collectionId,
              itemId,
              timestamp,
            },
          },
        })
        .toU8a()
    );
  }

  claimTransfer(
    collectionId: EventId,
    itemId: TicketId,
    commitMessage: Uint8Array
  ) {
    return this.createExtrinsic(
      this.api
        .createType("TicketPallet", {
          Call: {
            ClaimTransfer: {
              collectionId,
              itemId,
              commitMessage,
            },
          },
        })
        .toU8a()
    );
  }

  depositEvent(event: TicketEvent) {
    return this.createExtrinsic(
      this.api
        .createType("TicketPallet", {
          Event: event,
        })
        .toU8a()
    );
  }
}
