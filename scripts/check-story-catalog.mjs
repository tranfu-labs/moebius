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
    if (/\buserActionCoverage\s*:/u.test(metaTail)) {
      errors.push(`${relativePath}: userActionCoverage must be declared on the individual Page Story, not the meta`);
    }
    for (const story of storyObjectBlocks(source)) {
      const coverage = story.source.match(/\buserActionCoverage\s*:\s*\{([\s\S]*?)\}/u);
      if (coverage === null || !/\brequired\s*:\s*true\b/u.test(coverage[1])) {
        continue;
      }
      const hasLocalRender = /\brender\s*:/u.test(story.source);
      const hasInteractionPlay = /\bplay\s*:/u.test(story.source);
      const actionList = coverage[1].match(/\bactions\s*:\s*\[([\s\S]*?)\]/u)?.[1] ?? "";
      if (!hasLocalRender || !hasInteractionPlay || !/['"`][^'"`]+['"`]/u.test(actionList)) {
        errors.push(
          `${relativePath}:${story.name}: action-covered Page stories must provide local render, play, and a non-empty action list`,
        );
      }
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

function storyObjectBlocks(source) {
  const declarations = /export\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*(?:Story|StoryObj(?:<[^>\n]+>)?)\s*=\s*\{/gu;
  const blocks = [];
  for (const match of source.matchAll(declarations)) {
    const openBrace = (match.index ?? 0) + match[0].lastIndexOf("{");
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) continue;
    blocks.push({
      name: match[1],
      source: source.slice(match.index ?? 0, closeBrace + 1),
    });
  }
  return blocks;
}

function findMatchingBrace(source, openBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
