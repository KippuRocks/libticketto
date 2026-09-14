/// <reference types="node" />
import { webcrypto } from "node:crypto";
import { kreivoPassDefaultAddressGenerator } from "@virtonetwork/signer";
import { describe, expect, it } from "vitest";
import { Random } from "../test/random.js";
import { deriveSuite } from "../test/suites/derive.suite.js";
import { fromHex, toHex } from "./bytes.js";
import { hashedUserId, holderAccountId } from "./derive.js";

deriveSuite({ describe, it });

// REQ-MG-6: the holder account must be Kreivo's. Compared against
// virto-network/papi-signers itself, on Node (T-003-10 extends this).
describe("T-003-02 holder accounts against @virtonetwork/signer", () => {
  it("equal kreivoPassDefaultAddressGenerator's output for the same user id", async () => {
    const random = new Random(0x6b726569);
    for (let run = 0; run < 100; run++) {
      const userId = random.hex<string>(32);
      // WebAuthn.getHashedUserId: SHA-256 of the UTF-8 string, through WebCrypto.
      const theirHashed = new Uint8Array(
        await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)),
      );
      expect(toHex(hashedUserId(userId))).toBe(toHex(theirHashed));
      expect(holderAccountId(userId)).toBe(toHex(kreivoPassDefaultAddressGenerator(theirHashed)));
    }
    expect(fromHex(holderAccountId("ab".repeat(32)))).toHaveLength(32);
  });
});
