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
