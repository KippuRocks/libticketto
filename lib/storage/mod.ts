import { CID, File, IPFS } from "./types.js";

export function get(ipfs: IPFS, cid: CID) {
  return ipfs.get(cid);
}

export function set(ipfs: IPFS, file: File) {
  return ipfs.put(file);
}
