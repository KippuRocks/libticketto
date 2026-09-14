// Every portable suite, in the order the Hermes runner executes them.

import type { Suite } from "../harness.js";
import { codecSuite } from "./codec.suite.js";

export const SUITES: readonly Suite[] = [codecSuite];
