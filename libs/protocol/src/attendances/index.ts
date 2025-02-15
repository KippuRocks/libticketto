import { AttendancesCalls } from "./calls.js";
import { AttendancesStorage } from "./storage.js";

export type * from "./calls.js";
export type * from "./storage.js";

export type AttendancesModule = {
  calls: AttendancesCalls;
  query: AttendancesStorage;
};
