import type { AddressOrPair, SubmittableExtrinsic } from "@polkadot/api/types";
import Queue, { QueueWorker } from "queue";

import { IU8a } from "@polkadot/types/types";
import type { KeyringPair } from "@polkadot/keyring/types";

export class SigningQueue {
  q: Queue;
  constructor(private signers: KeyringPair[]) {
    this.q = new Queue({
      concurrency: 2 * signers.length,
      autostart: true,
    });
  }

  sign(extrinsic: SubmittableExtrinsic<"promise">) {
    console.log(`sign(${extrinsic.toHuman()})`);

    let resolve: (value: IU8a) => void;
    let reject: (reason?: unknown) => void;

    const promise = new Promise<IU8a>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const signJob: QueueWorker = async (callback) => {
      // Take a signer's key
      const signer = this.#signer;
      console.log(
        `[${
          signer?.address
        }] Going to asynchronously sign for ${extrinsic.toHuman()} at ${Date.now()}`
      );

      if (signer === undefined) {
        // Wait for a next key to be available.
        // Shouldn't take longer than 6s-12s
        this.q.push(signJob);
        return callback?.();
      }

      try {
        // Sign using the assigned key. Then, return the used key
        const hash = await signAndSend(extrinsic, signer);
        this.#signer = signer;

        resolve(hash);
        return callback?.(undefined, hash);
      } catch (error) {
        reject(error);
        return callback?.(error as Error);
      }
    };

    this.q.push(signJob);
    return promise;
  }

  get #signer(): KeyringPair | undefined {
    return this.signers.pop();
  }

  set #signer(value: KeyringPair) {
    this.signers.unshift(value);
  }
}

export function signAndSend(
  extrinsic: SubmittableExtrinsic<"promise">,
  signer: AddressOrPair
): Promise<IU8a> {
  return new Promise((resolve, reject) => {
    extrinsic.signAndSend(signer, ({ events = [], status }) => {
      if (status.isInBlock) {
        console.log(
          `[${Date.now()}] Successful submission of check-in with hash ${status.asInBlock.toHex()}`
        );
      } else {
        console.log("Status of transfer: " + status.type);
      }

      events.forEach(({ phase, event: { data, method, section } }) => {
        console.log(
          phase.toString() +
            " : " +
            section +
            "." +
            method +
            " " +
            data.toString()
        );
      });

      switch (status.type) {
        case "Dropped":
        case "FinalityTimeout":
        case "Invalid":
        case "Usurped":
          return reject(status.toJSON());
        case "InBlock":
          return resolve(status.asInBlock.hash);
        case "Finalized":
          return resolve(status.asFinalized.hash);
      }
    });
  });
}
