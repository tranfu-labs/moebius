import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const productionTsxRoots = [
  path.join(packageRoot, "src", "console"),
  path.join(packageRoot, "src", "onboarding"),
  path.join(packageRoot, "src", "ai-team-builder"),
  path.join(packageRoot, "src", "ui"),
  path.resolve(packageRoot, "..", "..", "desktop", "src", "onboarding"),
];
const productionSourceRoots = [
  path.resolve(packageRoot, "..", "..", "desktop", "src", "console-page"),
];

const productionFiles = [
  "ai-team-builder-ipc.ts",
  "ai-team-builder/contract.ts",
  "ai-team-builder/dto.ts",
  "preload.ts",
  "status-page/index.html",
  "status-page/status.js",
  "team-builder-view-state.ts",
  "team-file-manager-contract.ts",
  "team-file-manager.ts",
].map((file) => path.resolve(packageRoot, "..", "..", "desktop", "src", file));
productionFiles.push(
  path.join(packageRoot, "src", "console", "conversation-relay-rail-model.ts"),
  path.join(packageRoot, "src", "console", "member-name.ts"),
  path.join(packageRoot, "src", "console", "right-sidebar-tabs.ts"),
  path.join(packageRoot, "src", "onboarding", "onboarding-state.ts"),
);

const excludedSuffixes = [
  ".test.ts",
  ".test.tsx",
  ".stories.ts",
  ".stories.tsx",
];

function productionSourceFiles(root: string, extensions: readonly string[]): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return productionSourceFiles(target, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension))
      && !excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))
      ? [target]
      : [];
  });
}

const guardedFiles = [...new Set([
  ...productionTsxRoots.flatMap((root) => productionSourceFiles(root, [".tsx"])),
  ...productionSourceRoots.flatMap((root) => productionSourceFiles(root, [".ts", ".tsx"])),
  ...productionFiles,
])];

const repositoryRoot = path.resolve(packageRoot, "..", "..");

function hanLiteralViolations(file: string): string[] {
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
    /\p{Script=Han}/u.test(line) && !/i18n-exempt:\s+\S/u.test(line)
      ? [`${path.relative(repositoryRoot, file)}:${index + 1}: ${line.trim()}`]
      : []);
}

describe("production interface copy guard", () => {
  it("keeps literal CJK interface copy in locale resources", () => {
    expect(guardedFiles.flatMap(hanLiteralViolations)).toEqual([]);
  });

  it("forbids locale-driven copy branches in production components", () => {
    const violations = guardedFiles.flatMap((file) =>
      fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        /\blocale\s*(?:===|!==)|switch\s*\(\s*locale\b|\blocale\s*\?/u.test(line)
          && !/i18n-exempt:\s+\S/u.test(line)
          ? [`${path.relative(repositoryRoot, file)}:${index + 1}: ${line.trim()}`]
          : []));
    expect(violations).toEqual([]);
  });
});
