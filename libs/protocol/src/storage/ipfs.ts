import { CID } from "@ticketto/types/storage";
import { FileLike } from "@ticketto/types/primitives";

export interface IPFS {
  get(cid: CID): Promise<FileLike>;
  put(file: FileLike): Promise<CID>;
}
