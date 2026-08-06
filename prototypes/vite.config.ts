import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const input =
    mode === "agent-conversation"
      ? resolve(here, "agent-conversation.html")
      : mode === "main-conversation"
        ? resolve(here, "src/main-conversation/index.html")
      : mode === "main-left-sidebar"
        ? resolve(here, "src/main-left-sidebar/index.html")
      : mode === "main-right-sidebar"
        ? resolve(here, "src/main-right-sidebar/index.html")
      : mode === "byok-agent-runtime"
        ? resolve(here, "src/byok-agent-runtime/index.html")
      : mode === "settings"
        ? resolve(here, "src/settings/index.html")
      : resolve(here, "index.html");

  return {
    root: here,
    plugins: [
      react(),
      viteSingleFile({
        removeViteModuleLoader: true
      })
    ],
    build: {
      outDir: resolve(here, "dist"),
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      target: "es2020",
      rollupOptions: {
        input,
        output: {
          inlineDynamicImports: true
        }
      }
    }
  };
});
