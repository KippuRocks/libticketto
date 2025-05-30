import { DirectoryCalls } from "./calls.ts";
import { DirectoryStorage } from "./storage.ts";

export type * from "./calls.ts";
export type * from "./storage.ts";

export type DirectoryModule = {
  calls: DirectoryCalls;
  query: DirectoryStorage;
};
