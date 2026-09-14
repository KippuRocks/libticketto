#!/usr/bin/env node
import { resolve } from "node:path";
import { check, generate, type Outcome, vendor } from "./codegen.js";

// Usage, from the workspace root:
//   spec-codegen check                              — CI: pin and generated code agree with the spec
//   spec-codegen generate                           — rewrite the generated file
//   spec-codegen vendor <kippu-docs> <commit> <ref> — copy SPEC.md at a commit, pin it, regenerate

const root = process.cwd();
const [command, ...args] = process.argv.slice(2);

function run(): Outcome {
  switch (command) {
    case "check":
      return check(root);
    case "generate":
      return generate(root);
    case "vendor": {
      const [docs, commit, ref] = args;
      if (docs === undefined || commit === undefined || ref === undefined) {
        return { ok: false, messages: ["usage: spec-codegen vendor <kippu-docs> <commit> <ref>"] };
      }
      return vendor(root, resolve(docs), commit, ref);
    }
    default:
      return { ok: false, messages: ["usage: spec-codegen check | generate | vendor"] };
  }
}

const outcome = run();
for (const message of outcome.messages) (outcome.ok ? console.log : console.error)(message);
if (!outcome.ok) process.exitCode = 1;
else if (command === "check") console.log("spec-codegen: generated code matches spec/SPEC.md");
