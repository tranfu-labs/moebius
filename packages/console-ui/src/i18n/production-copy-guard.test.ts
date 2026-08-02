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

interface ProductionCopyDebt {
  file: string;
  hanLiteralCount: number;
  reason: string;
  removalChange: "four-layer-50-final-convergence";
}

const productionCopyDebt: readonly ProductionCopyDebt[] = [
  { file: "desktop/src/console-page/attachment-client.ts", hanLiteralCount: 7, reason: "legacy attachment transport errors bypass locale resources", removalChange: "four-layer-50-final-convergence" },
  { file: "desktop/src/console-page/attachment-preview.ts", hanLiteralCount: 4, reason: "legacy image preview errors bypass locale resources", removalChange: "four-layer-50-final-convergence" },
  { file: "desktop/src/console-page/edit-resend.ts", hanLiteralCount: 1, reason: "legacy edit-resend error bypasses locale resources", removalChange: "four-layer-50-final-convergence" },
  { file: "desktop/src/console-page/team-state.ts", hanLiteralCount: 1, reason: "legacy team save feedback bypasses locale resources", removalChange: "four-layer-50-final-convergence" },
  { file: "desktop/src/console-page/use-attachment-replacement.ts", hanLiteralCount: 2, reason: "legacy attachment replacement errors bypass locale resources", removalChange: "four-layer-50-final-convergence" },
  { file: "desktop/src/console-page/use-attachment-upload-queue.ts", hanLiteralCount: 1, reason: "legacy attachment upload error bypasses locale resources", removalChange: "four-layer-50-final-convergence" },
];

const repositoryRoot = path.resolve(packageRoot, "..", "..");
const relativeGuardedFiles = new Set(guardedFiles.map((file) => path.relative(repositoryRoot, file)));
const copyDebtByFile = new Map(productionCopyDebt.map((debt) => [debt.file, debt]));

function hanLiteralViolations(file: string): string[] {
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
    /\p{Script=Han}/u.test(line) && !/i18n-exempt:\s+\S/u.test(line)
      ? [`${path.relative(repositoryRoot, file)}:${index + 1}: ${line.trim()}`]
      : []);
}

describe("production interface copy guard", () => {
  it("keeps literal CJK interface copy in locale resources", () => {
    const violations = guardedFiles.flatMap((file) => {
      const relativeFile = path.relative(repositoryRoot, file);
      return copyDebtByFile.has(relativeFile) ? [] : hanLiteralViolations(file);
    });
    expect(violations).toEqual([]);
  });

  it("keeps legacy production copy debt exact and bound to its removal change", () => {
    const violations = productionCopyDebt.flatMap((debt) => {
      if (!relativeGuardedFiles.has(debt.file)) {
        return [`${debt.file}: stale debt does not match an automatically discovered production source`];
      }
      if (debt.reason.trim() === "" || debt.removalChange !== "four-layer-50-final-convergence") {
        return [`${debt.file}: debt must be reasoned and bound to four-layer-50-final-convergence`];
      }
      const actual = hanLiteralViolations(path.resolve(repositoryRoot, debt.file)).length;
      return actual === debt.hanLiteralCount
        ? []
        : [`${debt.file}: expected ${debt.hanLiteralCount} debt literals, found ${actual}`];
    });
    expect(new Set(copyDebtByFile).size).toBe(productionCopyDebt.length);
    expect(violations).toEqual([]);
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
