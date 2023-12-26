export type AccountId = string;

export type Balance = number;
export type AssetId = number;

export type AssetCode = string;

export type DateRange = [EpochTimeStamp, EpochTimeStamp];

export type FileLike = FileLocation | FileContent;
export type FileLocation = string | URL;
export type FileContent = Uint8Array | Blob;
