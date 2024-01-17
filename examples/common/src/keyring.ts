import { Keyring as PolkadotKeyring } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady } from "@polkadot/util-crypto";

export async function getKeyring() {
  await cryptoWaitReady();

  const { default: keys } = await import("../test-keys.json", {
    with: { type: "json" },
  });

  const keyring = new PolkadotKeyring({ type: "sr25519" });
  return new Keyring(
    Object.entries(keys)
      .map(
        ([name, suri]) =>
          [name, keyring.createFromUri(suri)] as [string, KeyringPair]
      )
      .reduce((o, [name, key]) => {
        o[name] = key;
        return o;
      }, {} as Record<string, KeyringPair>)
  );
}

class Keyring {
  constructor(private keypairs: Record<string, KeyringPair>) {}

  get(name: string) {
    return this.keypairs[name];
  }
}
