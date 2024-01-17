import type { CID } from "@ticketto/types/storage";
import type { FileLike } from "@ticketto/types/primitives";

export interface IPFS {
  get(cid: CID): Promise<FileLike>;
  put(file: FileLike): Promise<CID>;
  urlOf(cid: CID): Promise<string>;
}
