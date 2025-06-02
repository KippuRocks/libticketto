import { describe, it } from "node:test";

import { Stub } from "../src/stub/index.ts";
import assert from "node:assert";

describe("Stub", () => {
  it("constructing the Stub cleanly works correctly", async () => {
    const stub = new Stub();
    await stub.build({
      databaseName: "stubTest",
      genesisConfig: {},
    });

    assert.ok(stub.get("TickettoDB"));
  });

  it("constructing the Stub with the default mock works correctly", async () => {
    const stub = new Stub();
    await stub.build({
      databaseName: "stubTestWithDefaultMock",
    });

    assert.ok(stub.get("TickettoDB"));
  });
});
