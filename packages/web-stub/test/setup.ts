import "reflect-metadata";

import type { ShimmedObject } from "indexeddbshim/dist/setGlobalVars.d.ts";
import setGlobalVars from "indexeddbshim";

setGlobalVars(globalThis as unknown as ShimmedObject, {
  checkOrigin: false,
  memoryDatabase: ":memory:",
});
