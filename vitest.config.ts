import { defineConfig } from "vitest/config";

// One Vitest project per workspace package and tool, each keeping its tests
// beside its sources; plus the workspace's own checks under `test/`.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "tools/*",
      {
        test: {
          name: "workspace",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
