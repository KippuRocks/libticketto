import { api, sender, tx } from "./do-checkin.js";

// Sign and Send the transaction
await tx.signAndSend(sender, subscribeToMessages(api));
