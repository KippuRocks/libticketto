import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDefaultConfig, mergeConfig } from "@react-native/metro-config";
import Metro from "metro";

const require = createRequire(import.meta.url);
const run = promisify(execFile);

/** The tool's own directory: Metro's project root. */
export const projectRoot = join(import.meta.dirname, "..");
/** The workspace root: watched, so Metro follows pnpm's symlinks into `packages/`. */
export const workspaceRoot = join(projectRoot, "..", "..");

/** Hermes bytecode files start with this magic number, little-endian. */
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

export interface HermesBundle {
  readonly bundle: string;
  readonly bytecode: string;
}

export const PLATFORMS = ["android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Bundles `specifiers` for React Native with Metro, using React Native's own
 * resolver settings and Babel preset, then compiles the bundle to Hermes
 * bytecode with the `hermesc` React Native ships. Rejects if either step fails
 * — notably when a module in the graph cannot be resolved for React Native,
 * as with any Node.js built-in.
 */
export async function hermesBundle(
  name: string,
  specifiers: readonly string[],
  platform: Platform = "android",
): Promise<HermesBundle> {
  const outDir = join(projectRoot, ".hermes", name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const entry = join(outDir, "entry.js");
  writeFileSync(
    entry,
    [
      ...specifiers.map((specifier, i) => `import * as m${i} from ${JSON.stringify(specifier)};`),
      `globalThis.__ticketto = [${specifiers.map((_, i) => `m${i}`).join(", ")}];`,
      "",
    ].join("\n"),
  );

  const bundle = join(outDir, `${name}.${platform}.js`);
  const config = await Metro.loadConfig(
    { cwd: projectRoot, config: undefined },
    mergeConfig(getDefaultConfig(projectRoot), {
      projectRoot,
      watchFolders: [workspaceRoot],
      resolver: {
        nodeModulesPaths: [join(projectRoot, "node_modules")],
      },
      serializer: {
        // React Native's own start-up module lives in the `react-native`
        // package, which a library bundle does not need.
        getModulesRunBeforeMainModule: () => [],
      },
      reporter: { update: () => {} },
      cacheStores: [],
    }),
  );

  await Metro.runBuild(config, {
    entry,
    out: bundle,
    platform,
    dev: false,
    minify: false,
  });

  const bytecode = join(outDir, `${name}.${platform}.hbc`);
  try {
    await run(hermesc(), ["-emit-binary", "-O", "-out", bytecode, bundle]);
  } catch (error) {
    const { stderr } = error as { stderr?: string };
    throw new Error(`hermesc failed to compile ${bundle}\n${stderr ?? String(error)}`);
  }
  if (!readFileSync(bytecode).subarray(0, HERMES_MAGIC.length).equals(HERMES_MAGIC)) {
    throw new Error(`${bytecode} is not Hermes bytecode`);
  }
  return { bundle, bytecode };
}

function hermesc(): string {
  const dir = join(require.resolve("hermes-compiler/package.json"), "..", "hermesc");
  switch (process.platform) {
    case "darwin":
      return join(dir, "osx-bin", "hermesc");
    case "linux":
      return join(dir, "linux64-bin", "hermesc");
    case "win32":
      return join(dir, "win64-bin", "hermesc.exe");
    default:
      throw new Error(`hermesc is not shipped for ${process.platform}`);
  }
}
