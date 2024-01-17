import { GenericExtrinsic, Vec } from "@polkadot/types";

import type { AnyTuple } from "@polkadot/types/types";
import { ApiPromise } from "@polkadot/api";
import { EventRecord } from "@polkadot/types/interfaces";
import { SigningQueue } from "@kippurocks/examples_common";
import { TicketPallet } from "./chain/pallets/ticket.js";
import { blake2b } from "hash-wasm";
import { magicNumber } from "@ticketto/types/chain";

export function processRequests(
  api: ApiPromise,
  signingQueue: SigningQueue,
  extrinsics: Vec<GenericExtrinsic<AnyTuple>>,
  events: Vec<EventRecord>
) {
  const maybeExtrinsics = extrinsics.filter((ext) => {
    const { section, method, args } = ext.method;

    return (
      section.includes("system") &&
      method.includes("remarkWithEvent") &&
      args
        .at(0)
        ?.toU8a()
        .subarray(1, 7)
        .every((b, i) => b === magicNumber[i])
    );
  });

  maybeExtrinsics.forEach(async (ext) => {
    const remarkedEvent = events.find(({ event }) => {
      const signer = ext.signer.toU8a().subarray(1);

      return (
        event.section.includes("system") &&
        event.method.includes("Remarked") &&
        event.data
          .at(0)
          ?.toU8a()
          .every((b, i) => b === signer.at(i))
      );
    });

    const remarkHash = `0x${await blake2b(
      ext.args.at(0)?.toU8a().subarray(1)!,
      256
    )}`;

    if (remarkHash !== remarkedEvent?.event.data.at(1)?.toHex()) {
      return;
    }

    TicketPallet.dispatch(api, signingQueue, ext);
  });
}
