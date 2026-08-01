#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import {
  analyzeImportBoundaries,
  validateBoundaryDocumentation,
  type RepositoryFile,
  type FourLayerArchitectureConfig,
} from "../src/testing/import-boundaries.js";
import { analyzeFourLayerArchitecture } from "../src/testing/four-layer-boundaries.js";
import {
  FOUR_LAYER_BOUNDARY_RULE_IDS,
  FOUR_LAYER_CONFIG,
} from "../src/testing/four-layer-registry.js";

const SOURCE_ROOTS = ["src", "desktop/src", "packages/console-ui/src"] as const;
const RESOLUTION_ONLY_ROOTS = ["assets"] as const;
const SOURCE_PATTERN = /\.(?:cts|mts|ts|tsx)$/u;

async function main(): Promise<number> {
  const repositoryRoot = process.cwd();
  const fixtureFlag = process.argv.indexOf("--fixture");
  const fixtureName = fixtureFlag >= 0 ? process.argv[fixtureFlag + 1] : undefined;
  if (fixtureName !== undefined) return runCounterexampleFixture(repositoryRoot, fixtureName);
  const repositoryPaths = new Set<string>();
  const files: RepositoryFile[] = [];
  const productionPaths = new Set<string>();
  for (const root of SOURCE_ROOTS) {
    for (const filePath of await listFiles(path.join(repositoryRoot, root))) {
      const relativePath = path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
      repositoryPaths.add(relativePath);
      if (SOURCE_PATTERN.test(relativePath) && !isGeneratedOrFixture(relativePath)) {
        files.push({ path: relativePath, source: await fs.readFile(filePath, "utf8") });
        if (isProductionSource(relativePath)) productionPaths.add(relativePath);
      }
    }
  }
  for (const root of RESOLUTION_ONLY_ROOTS) {
    for (const filePath of await listFiles(path.join(repositoryRoot, root))) {
      repositoryPaths.add(path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/"));
    }
  }

  const violations = [
    ...analyzeImportBoundaries({ files, knownPaths: repositoryPaths }),
    ...analyzeFourLayerArchitecture({
      files,
      productionPaths,
      knownPaths: repositoryPaths,
      config: FOUR_LAYER_CONFIG,
    }),
  ];
  const moduleMap = await fs.readFile(
    path.join(repositoryRoot, "docs/architecture/module-map.md"),
    "utf8",
  );
  const documentationErrors = validateBoundaryDocumentation({
    markdown: moduleMap,
    additionalRuleIds: FOUR_LAYER_BOUNDARY_RULE_IDS,
  });
  if (violations.length === 0 && documentationErrors.length === 0) {
    console.log(
      `[import-boundaries] ok: ${String(files.length)} source files, `
      + `${String(productionPaths.size)} production files, ${String(SOURCE_ROOTS.length)} roots`,
    );
    return 0;
  }

  for (const violation of violations) {
    console.error(
      `[import-boundaries] ${violation.ruleId}: importer=${violation.importer} `
      + (violation.line === undefined ? "" : `line=${String(violation.line)} `)
      + `specifier=${JSON.stringify(violation.specifier)} target=${violation.resolvedTarget}`
      + (violation.dependencyPath === undefined
        ? ""
        : ` path=${violation.dependencyPath.join(" -> ")}`)
      + (violation.detail === undefined ? "" : ` detail=${violation.detail}`),
    );
  }
  for (const error of documentationErrors) {
    console.error(`[import-boundaries] module-map: ${error}`);
  }
  return 1;
}

async function runCounterexampleFixture(repositoryRoot: string, name: string): Promise<number> {
  const root = path.join(repositoryRoot, "tests/fixtures/four-layer-boundaries", name);
  const fixturePaths = (await listFiles(root)).filter((file) => SOURCE_PATTERN.test(file));
  const files = await Promise.all(fixturePaths.map(async (filePath) => ({
    path: path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/"),
    source: await fs.readFile(filePath, "utf8"),
  })));
  const config = fixtureConfig(name, files.map((file) => file.path));
  const violations = analyzeFourLayerArchitecture({
    files,
    productionPaths: new Set(files.map((file) => file.path)),
    config,
  });
  for (const violation of violations) {
    console.error(
      `[import-boundaries] ${violation.ruleId}: importer=${violation.importer} line=${String(violation.line ?? 1)} `
      + `specifier=${JSON.stringify(violation.specifier)} target=${violation.resolvedTarget}`
      + (violation.dependencyPath === undefined ? "" : ` path=${violation.dependencyPath.join(" -> ")}`)
      + (violation.detail === undefined ? "" : ` detail=${violation.detail}`),
    );
  }
  return violations.length === 0 ? 0 : 1;
}

function fixtureConfig(name: string, paths: readonly string[]): FourLayerArchitectureConfig {
  const exact = (layer: "view" | "application" | "domain" | "adapter", file: string) => ({
    layer,
    scope: { kind: "exact" as const, value: file },
  });
  const first = paths[0]!;
  const assignments = name === "assignment-unassigned"
    ? []
    : name === "assignment-multiple"
      ? [exact("view", first), exact("domain", first)]
      : paths.map((file) => exact(
        name.startsWith("application-") && file.endsWith("/decision.ts")
          ? "domain"
          : name.startsWith("application-") || name === "stale-transport-permit"
            ? "application"
            : name.startsWith("adapter-") ? "adapter" : "domain",
        file,
      ));
  return {
    assignments,
    compositionRoots: name === "application-composition-root-lines" ? [first] : [],
    dependencyDebt: [],
    fileDebt: [],
    conditionPermits: name === "stale-transport-permit" ? [{
      ruleId: "application-use-case-shape",
      file: first,
      exportName: "executeFixture",
      fingerprint: "signal.aborted",
      kind: "transport-control",
      contract: "AbortSignal",
    }] : [],
  };
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

function isProductionSource(filePath: string): boolean {
  return !filePath.startsWith("src/testing/")
    && !filePath.includes("/test/")
    && !/\.(?:test|stories)\.(?:ts|tsx)$/u.test(filePath);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
