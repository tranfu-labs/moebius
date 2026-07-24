import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSandboxedPreloadBundle,
  assertStaticNodeBundle,
} from "./node-bundle-contract.mjs";
import { assertCompiledRendererStyles } from "./renderer-style-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const brandAssets = path.join(root, "..", "assets", "brand", "generated");
const yamlBrowserEntry = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("yaml/package.json"))),
  "browser/index.js",
);

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, "status-page"), { recursive: true });
await fs.mkdir(path.join(dist, "console-page"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  outdir: dist,
  external: ["electron", "electron-updater"],
  alias: {
    // yaml's Node export is CommonJS. Inlining it into an ESM Electron bundle
    // leaves esbuild's dynamic-require shim, while the package's browser export
    // is equivalent for parse/stringify and is native ESM.
    yaml: yamlBrowserEntry,
  },
};

await build({
  ...common,
  entryPoints: [
    path.join(root, "src/main.ts"),
    path.join(root, "src/runner-child.ts"),
  ],
});

await Promise.all(
  ["main.js", "runner-child.js"].map(async (fileName) => {
    const bundle = await fs.readFile(path.join(dist, fileName), "utf8");
    assertStaticNodeBundle(bundle, fileName);
  }),
);

// sqlite-state.ts resolves its worker thread module relative to its own bundled
// location (./sqlite-state-worker.js next to main.js/runner-child.js), so it must be
// built as its own output file rather than inlined into the bundles above.
await build({
  ...common,
  entryPoints: [path.join(root, "..", "src/sqlite-state-worker.ts")],
  outdir: undefined,
  outfile: path.join(dist, "sqlite-state-worker.js"),
});

await build({
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  entryPoints: [path.join(root, "src/preload.ts")],
  outfile: path.join(dist, "preload.cjs"),
  external: ["electron"],
});

const preloadBundle = await fs.readFile(path.join(dist, "preload.cjs"), "utf8");
assertSandboxedPreloadBundle(preloadBundle, "preload.cjs");

await build({
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  alias: {
    "@moebius/console-ui/globals.css": path.join(root, "../packages/console-ui/dist/style.css"),
  },
  sourcemap: true,
  entryPoints: [path.join(root, "src/console-page/app.tsx")],
  outfile: path.join(dist, "console-page/app.js"),
  loader: {
    ".css": "css",
    ".png": "dataurl",
  },
});

const rendererCssPath = path.join(dist, "console-page/app.css");
const rendererCss = await fs.readFile(rendererCssPath, "utf8");
assertCompiledRendererStyles(rendererCss);

await fs.copyFile(path.join(root, "src/console-page/index.html"), path.join(dist, "console-page/index.html"));
await fs.copyFile(path.join(root, "src/console-page/console.css"), path.join(dist, "console-page/console.css"));
await fs.copyFile(path.join(brandAssets, "favicon-32.png"), path.join(dist, "console-page/favicon-32.png"));
await fs.copyFile(path.join(root, "src/status-page/index.html"), path.join(dist, "status-page/index.html"));
await fs.copyFile(path.join(root, "src/status-page/status.css"), path.join(dist, "status-page/status.css"));
await fs.copyFile(path.join(root, "src/status-page/status.js"), path.join(dist, "status-page/status.js"));
await fs.copyFile(path.join(brandAssets, "favicon-32.png"), path.join(dist, "status-page/favicon-32.png"));
await fs.copyFile(path.join(brandAssets, "ui-icon-64.png"), path.join(dist, "status-page/moebius-icon-64.png"));
await fs.copyFile(path.join(brandAssets, "app-icon-1024.png"), path.join(dist, "app-icon-1024.png"));
