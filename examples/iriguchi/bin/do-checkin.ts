import { Keyring } from "@polkadot/api";
import { TicketSubmitter } from "../lib/chain/submitters/ticket.js";
import { createApi } from "@kippurocks/examples_common/api";

const api = await createApi();
const keyring = new Keyring({ type: "sr25519" });

// Define the sender
const sender = keyring.addFromMnemonic(
  "squirrel easily wheel crunch age earth fee maple dish gown target differ"
);

// Create a extrinsic, 'authoring' the checkIn call.
const tx = await new TicketSubmitter(api).checkin(226, 0, 1704428100000);
console.log(tx.toHuman());

// Sign and Send the transaction
await tx.signAndSend(sender, ({ events = [], status }) => {
  if (status.isInBlock) {
    console.log(
      `[${Date.now()}] Successful submission of check-in with hash ${status.asInBlock.toHex()}`
    );
  } else {
    console.log("Status of transfer: " + status.type);
  }

  events.forEach(({ phase, event: { data, method, section } }) => {
    console.log(
      phase.toString() + " : " + section + "." + method + " " + data.toString()
    );
  });

  if (status.type === "Finalized") {
    api.disconnect();
    process.exit(0);
  }
});
