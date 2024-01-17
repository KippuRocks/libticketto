import type { CID } from "@ticketto/types/storage";
import type { FileLike } from "@ticketto/types/primitives";
import { IPFS } from "./ipfs.js";

export function get(ipfs: IPFS, cid: CID) {
  return ipfs.get(cid);
}

export function set(ipfs: IPFS, file: FileLike) {
  return ipfs.put(file);
}
