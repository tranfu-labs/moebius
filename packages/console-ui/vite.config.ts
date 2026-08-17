import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(here, "src")
    }
  },
  build: {
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    lib: {
      entry: {
        index: resolve(here, "src/index.ts"),
        styles: resolve(here, "src/style-entry.ts"),
        "markdown-file-reference-plan": resolve(here, "src/console/markdown-file-reference-plan.ts")
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@radix-ui/react-avatar",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-popover",
        "@radix-ui/react-slot",
        "class-variance-authority",
        "clsx",
        "lucide-react",
        "tailwind-merge"
      ]
    }
  }
});
