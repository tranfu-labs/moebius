#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStoryRoot = path.resolve(scriptDir, "..", "packages", "console-ui", "src");
const storyRoot = path.resolve(process.argv[2] ?? defaultStoryRoot);
const layers = ["Component", "Block", "Page"];
const counts = new Map(layers.map((layer) => [layer, 0]));
const errors = [];

const storyFiles = (await walk(storyRoot))
  .filter((filePath) => filePath.endsWith(".stories.ts") || filePath.endsWith(".stories.tsx"))
  .sort();

if (storyFiles.length === 0) {
  errors.push(`No Storybook stories found under ${storyRoot}`);
}

for (const filePath of storyFiles) {
  const source = await fs.readFile(filePath, "utf8");
  const relativePath = path.relative(storyRoot, filePath);
  const catalogTitles = [
    ...source.matchAll(/\btitle\s*:\s*["'`](Component|Block|Page)\/([^"'`]+)["'`]/gu),
  ];

  if (catalogTitles.length !== 1) {
    errors.push(
      `${relativePath}: expected exactly one Meta.title starting with Component/, Block/, or Page/; found ${catalogTitles.length}`,
    );
    continue;
  }

  const layer = catalogTitles[0][1];
  counts.set(layer, (counts.get(layer) ?? 0) + 1);

  if (layer === "Page") {
    const titleOffset = catalogTitles[0].index ?? 0;
    const metaTail = source.slice(titleOffset, source.indexOf("export default meta", titleOffset));
    if (!/\bparameters\s*:\s*\{[\s\S]*?\blayout\s*:\s*["'`]fullscreen["'`]/u.test(metaTail)) {
      errors.push(`${relativePath}: Page stories must set meta parameters.layout to "fullscreen"`);
    }
  }
}

for (const layer of layers) {
  if ((counts.get(layer) ?? 0) === 0) {
    errors.push(`Storybook catalog must contain at least one ${layer} story`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`story-catalog: ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `story-catalog: ${storyFiles.length} stories (${layers
      .map((layer) => `${layer}=${counts.get(layer)}`)
      .join(", ")})\n`,
  );
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}
