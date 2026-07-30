import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const productionRoots = [
  path.join(packageRoot, "src", "console"),
  path.join(packageRoot, "src", "onboarding"),
  path.join(packageRoot, "src", "ai-team-builder"),
  path.join(packageRoot, "src", "ui"),
  path.resolve(packageRoot, "..", "..", "desktop", "src", "console-page"),
  path.resolve(packageRoot, "..", "..", "desktop", "src", "onboarding"),
];

const productionFiles = [
  "ai-team-builder-ipc.ts",
  "ai-team-builder/contract.ts",
  "ai-team-builder/dto.ts",
  "console-page/state-sync.ts",
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

function productionTsxFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return productionTsxFiles(target);
    }
    return entry.name.endsWith(".tsx")
      && !excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))
      ? [target]
      : [];
  });
}

const guardedFiles = [
  ...productionRoots.flatMap(productionTsxFiles),
  ...productionFiles,
];

describe("production interface copy guard", () => {
  it("keeps literal CJK interface copy in locale resources", () => {
    const violations = guardedFiles.flatMap((file) =>
      fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
        /\p{Script=Han}/u.test(line) && !/i18n-exempt:\s+\S/u.test(line)
          ? [`${path.relative(path.resolve(packageRoot, "..", ".."), file)}:${index + 1}: ${line.trim()}`]
          : []));
    expect(violations).toEqual([]);
  });

  it("forbids locale-driven copy branches in production components", () => {
    const violations = guardedFiles.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /\blocale\s*(?:===|!==)|switch\s*\(\s*locale\b|\blocale\s*\?/u.test(source)
        ? [path.relative(path.resolve(packageRoot, "..", ".."), file)]
        : [];
    });
    expect(violations).toEqual([]);
  });
});
