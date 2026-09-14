// Every portable suite, in the order the Hermes runner executes them.

import type { Suite } from "../harness.js";
import { codecSuite } from "./codec.suite.js";
import { deriveSuite } from "./derive.suite.js";
import { p256Suite } from "./p256.suite.js";
import { webAuthnSuite } from "./webauthn.suite.js";

export const SUITES: readonly Suite[] = [codecSuite, deriveSuite, p256Suite, webAuthnSuite];
