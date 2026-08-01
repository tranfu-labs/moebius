#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import {
  analyzeImportBoundaries,
  validateBoundaryDocumentation,
  type RepositoryFile,
} from "../src/testing/import-boundaries.js";

const SOURCE_ROOTS = ["src", "desktop/src", "packages/console-ui/src"] as const;
const RESOLUTION_ONLY_ROOTS = ["assets"] as const;
const SOURCE_PATTERN = /\.(?:cts|mts|ts|tsx)$/u;

async function main(): Promise<number> {
  const repositoryRoot = process.cwd();
  const repositoryPaths = new Set<string>();
  const files: RepositoryFile[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const filePath of await listFiles(path.join(repositoryRoot, root))) {
      const relativePath = path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
      repositoryPaths.add(relativePath);
      if (SOURCE_PATTERN.test(relativePath) && !isGeneratedOrFixture(relativePath)) {
        files.push({ path: relativePath, source: await fs.readFile(filePath, "utf8") });
      }
    }
  }
  for (const root of RESOLUTION_ONLY_ROOTS) {
    for (const filePath of await listFiles(path.join(repositoryRoot, root))) {
      repositoryPaths.add(path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/"));
    }
  }

  const violations = analyzeImportBoundaries({ files, knownPaths: repositoryPaths });
  const moduleMap = await fs.readFile(
    path.join(repositoryRoot, "docs/architecture/module-map.md"),
    "utf8",
  );
  const documentationErrors = validateBoundaryDocumentation({ markdown: moduleMap });
  if (violations.length === 0 && documentationErrors.length === 0) {
    console.log(
      `[import-boundaries] ok: ${String(files.length)} source files, `
      + `${String(SOURCE_ROOTS.length)} roots`,
    );
    return 0;
  }

  for (const violation of violations) {
    console.error(
      `[import-boundaries] ${violation.ruleId}: importer=${violation.importer} `
      + `specifier=${JSON.stringify(violation.specifier)} target=${violation.resolvedTarget}`
      + (violation.dependencyPath === undefined
        ? ""
        : ` path=${violation.dependencyPath.join(" -> ")}`),
    );
  }
  for (const error of documentationErrors) {
    console.error(`[import-boundaries] module-map: ${error}`);
  }
  return 1;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

function isGeneratedOrFixture(filePath: string): boolean {
  return filePath.includes("/__fixtures__/")
    || filePath.includes("/fixtures/")
    || filePath.includes("/generated/")
    || filePath.endsWith(".d.ts");
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
