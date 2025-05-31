import { AttendancesCalls } from "./calls.ts";
import { AttendancesStorage } from "./storage.ts";

export type * from "./calls.ts";
export type * from "./events.ts";
export type * from "./storage.ts";

export type AttendancesModule = {
  calls: AttendancesCalls;
  query: AttendancesStorage;
};
