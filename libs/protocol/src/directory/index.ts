import { DirectoryCalls } from "./calls.js";
import { DirectoryStorage } from "./storage.js";

export type * from "./calls.js";
export type * from "./storage.js";

export type DirectoryModule = {
  calls: DirectoryCalls;
  query: DirectoryStorage;
};
