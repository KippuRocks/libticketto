import { AccountId, EventId, TicketId } from "@ticketto/types";

import { AnyTuple } from "@polkadot/types/types";
import { ApiPromise } from "@polkadot/api";
import { CheckInEvent } from "@ticketto/types/chain.types.d";
import { GenericExtrinsic } from "@polkadot/types";
import { SigningQueue } from "@kippurocks/examples_common/signing-queue";
import { TicketSubmitter } from "../submitters/ticket.js";
import { getKeyring } from "@kippurocks/examples_common/keyring";

const keyring = await getKeyring();
const issuer = keyring.get("ticketto//issuer");

type Dispatchable = {
  call?: {
    checkin?: {
      collectionId: EventId;
      itemId: TicketId;
      timestamp: number;
    };
    claimTransfer?: {
      collectionId: EventId;
      itemId: TicketId;
      commitMessage: Uint8Array;
    };
  };
  event: {
    checkinConfirmed: CheckInEvent;
    checkinRejected: CheckInEvent;
  };
};

export class TicketPallet {
  static dispatch(
    api: ApiPromise,
    signingQueue: SigningQueue,
    extrinsic: GenericExtrinsic<AnyTuple>
  ) {
    try {
      const {
        signer: { value: signer },
        method: { args },
      } = extrinsic;
      const call = api.createType(
        "TicketPallet",
        args.at(0)?.toU8a().subarray(7)
      );
      const dispatchable = call.toPrimitive() as unknown as Dispatchable;

      const pallet = new TicketPallet(api, signingQueue);
      switch (true) {
        case dispatchable.call?.checkin !== undefined: {
          const { collectionId, itemId, timestamp } = dispatchable.call.checkin;
          return pallet.checkin(
            signer.toString(),
            collectionId,
            itemId,
            timestamp
          );
        }
        case dispatchable.call?.claimTransfer !== undefined: {
          const { collectionId, itemId, commitMessage } =
            dispatchable.call.claimTransfer;
          return pallet.claimTransfer(
            signer.toString(),
            collectionId,
            itemId,
            commitMessage
          );
        }
        case dispatchable?.event !== undefined: {
          console.log(dispatchable.event);
        }
      }
    } catch { }
  }

  submitter: TicketSubmitter;
  constructor(private api: ApiPromise, private signingQueue: SigningQueue) {
    this.submitter = new TicketSubmitter(api);
  }

  async checkin(
    origin: AccountId,
    collectionId: EventId,
    itemId: TicketId,
    timestamp: number
  ) {
    console.log("TicketPallet#checkin", {
      origin,
      collectionId,
      itemId,
      timestamp,
    });

    const attributesStorage = await this.api.query.nfts.attribute.entries(
      collectionId,
      itemId,
      {
        Account: issuer.address,
      }
    );

    type ItemAttributeKey = [EventId, TicketId | null, unknown, string];
    type ItemAttribute = [string, unknown];

    const attributes = attributesStorage.map(([key, entry]) => ({
      key: key.toHuman() as unknown as ItemAttributeKey,
      entry: entry.toJSON() as unknown as ItemAttribute,
    }));

    if (attributes.find(({ key: [, , , key] }) => key.includes("att"))) {
      console.log(
        `Rejecting check-in for ${origin} on (${collectionId}, ${itemId})`
      );

      return await this.signingQueue.sign(
        await this.submitter.depositEvent({
          CheckinRejected: {
            who: origin,
            ticket: [collectionId, itemId],
            when: timestamp,
          },
        })
      );
    }

    console.log(
      `Confirming check-in for ${origin} on (${collectionId}, ${itemId})`
    );

    const tx = this.api.tx.proxy.proxy(
      issuer.address,
      null,
      this.api.tx.nfts.setAttribute(
        collectionId,
        itemId,
        {
          Account: issuer.address,
        },
        "att",
        timestamp
      )
    );

    await this.signingQueue.sign(tx);

    return await this.signingQueue.sign(
      await this.submitter.depositEvent({
        CheckinConfirmed: {
          who: origin,
          ticket: [collectionId, itemId],
          when: timestamp,
        },
      })
    );
  }

  async claimTransfer(
    origin: AccountId,
    collectionId: EventId,
    itemId: TicketId,
    commitMessage: Uint8Array
  ) { }
}
