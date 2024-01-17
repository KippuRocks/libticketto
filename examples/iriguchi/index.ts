import { SigningQueue, getKeyring } from "@kippurocks/examples_common";

import type { EventRecord } from "@polkadot/types/interfaces";
import type { Vec } from "@polkadot/types";
import { createApi } from "@kippurocks/examples_common/api";
import { processRequests } from "./lib/process-requests.js";

const api = await createApi();
const keyring = await getKeyring();

const signingQueue = new SigningQueue([
  keyring.get("ticketto//api-user"),
  keyring.get("ticketto//api-user/1"),
  keyring.get("ticketto//api-user/2"),
]);

api.rpc.chain.subscribeNewHeads(async (header) => {
  const { hash, number } = header;
  console.log(`\nChain is at block: #${number.toHuman()} at ${Date.now()}`);

  const {
    block: { extrinsics },
  } = await api.rpc.chain.getBlock(hash);

  const events = await (await api.at(hash)).query.system.events();
  // console.log("Events:", events.toHuman());

  processRequests(api, signingQueue, extrinsics, events as Vec<EventRecord>);
});
