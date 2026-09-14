import { describe, it } from "vitest";
import { codecSuite } from "../../test/suites/codec.suite.js";

// The portable suite, registered with Vitest. test/hermes runs the same suite
// under the Hermes VM.
codecSuite({ describe, it });
