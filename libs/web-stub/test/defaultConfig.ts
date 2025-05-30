import { type ClientConfig } from "@ticketto/protocol";

export const defaultConfig: ClientConfig = {
  accountProvider: {
    getAccountId: () => "5DD8bv4RnTDuJt47SAjpWMT78N7gfBQNF2YiZpVUgbXkizMG",
    sign: (payload: Uint8Array) => Promise.resolve(payload),
  },
};
