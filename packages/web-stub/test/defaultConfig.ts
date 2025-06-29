import { type ClientConfig } from "@ticketto/protocol";

export const defaultConfig: ClientConfig<Uint8Array> = {
  accountProvider: {
    getAccountId: () => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
    sign: <T>(payload: T) => payload instanceof Uint8Array
      ? Promise.resolve(payload)
      : Promise.reject(new TypeError("Expects `payload` is an instance of `Uint8Array`")),
  },
};
