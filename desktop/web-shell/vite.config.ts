import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const consoleUiSrc = resolve(here, "../../packages/console-ui/src");
const consoleUiDist = resolve(here, "../../packages/console-ui/dist");

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      "@moebius/console-ui/globals.css": resolve(consoleUiDist, "style.css"),
      "@moebius/console-ui/console/agent-form-model": resolve(consoleUiSrc, "console/agent-form-model.ts"),
      "@moebius/console-ui/console/agent-form-protocol": resolve(consoleUiSrc, "console/agent-form-protocol.ts"),
      "@moebius/console-ui/console/markdown-file-reference-plan": resolve(
        consoleUiSrc,
        "console/markdown-file-reference-plan.ts",
      ),
      "@moebius/console-ui": resolve(consoleUiSrc, "index.ts"),
      "@": consoleUiSrc,
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_SHELL_PORT ?? 5180),
    strictPort: false,
  },
});
