export type File = Blob | Object;
export type CID = string;

export interface IPFS {
  get(cid: CID): Promise<File>;
  put(file: File): Promise<CID>;
}
