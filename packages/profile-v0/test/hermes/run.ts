// Runs a portable entry point under the Hermes VM.
//
//   node test/hermes/run.ts [entry]      (entry defaults to "entry")
//
// 1. Bundles test/hermes/<entry>.ts with Metro and React Native's Babel preset,
//    as an app would (the same configuration as tools/hermes-bundle).
// 2. Compiles the bundle with the `hermesc` React Native ships.
// 3. Executes the bytecode with a Hermes VM built from the same Hermes release
//    (test/hermes/build-vm.sh), found at $HERMES_VM.
//
// The entry prints `HERMES-SUMMARY {"passed":n,"failed":m}` as its last line;
// this script exits non-zero unless it reports no failures. Extra output
// (benchmark results) is written to stdout unchanged.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getDefaultConfig, mergeConfig } from "@react-native/metro-config";
import Metro from "metro";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

const hermesDir = import.meta.dirname;
const packageRoot = resolve(hermesDir, "..", "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const outDir = join(packageRoot, ".hermes");

function hermesc(): string {
  const dir = join(dirname(require.resolve("hermes-compiler/package.json")), "hermesc");
  const bin = { darwin: "osx-bin/hermesc", linux: "linux64-bin/hermesc" }[
    process.platform as "darwin" | "linux"
  ];
  if (bin === undefined) throw new Error(`hermesc is not shipped for ${process.platform}`);
  return join(dir, bin);
}

function hermesVm(): string {
  const vm = process.env.HERMES_VM;
  if (vm === undefined || !existsSync(vm)) {
    throw new Error(
      "Set HERMES_VM to a Hermes VM built from the release matching hermes-compiler: " +
        "test/hermes/build-vm.sh <dir> builds one.",
    );
  }
  return vm;
}

async function bundle(entryName: string): Promise<string> {
  const entry = join(hermesDir, `${entryName}.ts`);
  const out = join(outDir, `${entryName}.js`);
  const config = await Metro.loadConfig(
    { cwd: hermesDir, config: undefined },
    mergeConfig(getDefaultConfig(hermesDir), {
      projectRoot: hermesDir,
      watchFolders: [workspaceRoot],
      resolver: {
        nodeModulesPaths: [join(packageRoot, "node_modules")],
        // Sources import siblings as `./x.js` (Node ESM resolution); the file is `x.ts`.
        resolveRequest: (context, moduleName, platform) => {
          if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
            const candidate = resolve(
              dirname(context.originModulePath),
              `${moduleName.slice(0, -3)}.ts`,
            );
            if (existsSync(candidate)) return { type: "sourceFile", filePath: candidate };
          }
          return context.resolveRequest(context, moduleName, platform);
        },
      },
      serializer: { getModulesRunBeforeMainModule: () => [] },
      reporter: { update: () => {} },
      cacheStores: [],
    }),
  );
  await Metro.runBuild(config, { entry, out, platform: "android", dev: false, minify: false });
  return out;
}

async function main(): Promise<void> {
  const entryName = process.argv[2] ?? "entry";
  const vm = hermesVm();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const source = await bundle(entryName);
  const bytecode = source.replace(/\.js$/, ".hbc");
  await run(hermesc(), ["-emit-binary", "-O", "-out", bytecode, source]);

  const { stdout } = await run(vm, [bytecode], { maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(stdout);

  const summaryLine = stdout
    .trimEnd()
    .split("\n")
    .filter((line) => line.startsWith("HERMES-SUMMARY "))
    .at(-1);
  if (summaryLine === undefined) throw new Error("the Hermes run printed no summary");
  const summary = JSON.parse(summaryLine.slice("HERMES-SUMMARY ".length)) as {
    passed: number;
    failed: number;
  };
  const { version } = JSON.parse(
    readFileSync(require.resolve("hermes-compiler/package.json"), "utf8"),
  ) as { version: string };
  console.log(
    `hermes: ${summary.passed} passed, ${summary.failed} failed (hermes-compiler ${version})`,
  );
  if (summary.failed > 0 || summary.passed === 0) process.exitCode = 1;
}

await main();
