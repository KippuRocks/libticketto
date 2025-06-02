export type Get<T> = () => T;

export type Timestamp = bigint;
export type HexString = `0x${string}`;

export type BlockNumber = number;
export type Balance = bigint;
export type AssetId = number;

export type AssetCode = string;

export type DateRange = [Timestamp, Timestamp];

export type FileLike = FileLocation | FileContent;
export type FileLocation = string | URL;
export type FileContent = Uint8Array | Blob;
export type Metadata = Record<string | number | symbol, unknown>;
