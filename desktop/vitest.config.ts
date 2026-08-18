import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@moebius/console-ui/globals.css",
        replacement: resolve(here, "../packages/console-ui/src/styles/globals.css"),
      },
      {
        find: "@moebius/console-ui/console/markdown-file-reference-plan",
        replacement: resolve(here, "../packages/console-ui/src/console/markdown-file-reference-plan.ts"),
      },
      {
        find: "@moebius/console-ui",
        replacement: resolve(here, "../packages/console-ui/src/index.ts"),
      },
      {
        find: "@",
        replacement: resolve(here, "../packages/console-ui/src"),
      },
    ],
  },
  test: {
    environment: "node",
  },
});
