import { ApiPromise } from "@polkadot/api";
import { hex } from "@kippurocks/examples_common/format";
import { magicNumber } from "@ticketto/types/chain";

export class Submitter {
  constructor(private _api: ApiPromise) {}

  async createRemark(extrinsic: Uint8Array) {
    return hex(await new Blob([magicNumber, extrinsic]).arrayBuffer());
  }

  async createExtrinsic(extrinsic: Uint8Array) {
    return this._api.tx.system.remarkWithEvent(
      await this.createRemark(extrinsic)
    );
  }
}
