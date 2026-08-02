import { describe, expect, it } from "vitest";

import {
  analyzeImportBoundaries,
  validateBoundaryDocumentation,
  type ImportBoundaryRule,
} from "../src/testing/import-boundaries.js";
import { analyzeFourLayerArchitecture } from "../src/testing/four-layer-boundaries.js";

const rule: ImportBoundaryRule = {
  id: "pure-no-runtime",
  importers: [{ kind: "prefix", value: "src/pure/" }],
  deniedRepositoryTargets: [{ kind: "prefix", value: "src/runtime/" }],
  deniedExternalSpecifiers: ["node:fs"],
  allow: [{
    importer: { kind: "exact", value: "src/pure/allowed.ts" },
    target: { kind: "exact", value: "src/runtime/types.ts" },
  }],
};

describe("import boundary analysis", () => {
  it("reports static import, export-from, and literal dynamic import violations", () => {
    const violations = analyzeImportBoundaries({
      files: [
        {
          path: "src/pure/a.ts",
          source: [
            'import "../runtime/adapter.js";',
            'export { value } from "../runtime/value.js";',
            'void import("../runtime/lazy.js");',
            'import type { Local } from "./local.js";',
          ].join("\n"),
        },
        { path: "src/pure/local.ts", source: "export type Local = string;" },
        { path: "src/runtime/adapter.ts", source: "" },
        { path: "src/runtime/value.ts", source: "export const value = 1;" },
        { path: "src/runtime/lazy.ts", source: "" },
      ],
      rules: [rule],
    });
    expect(violations).toEqual([
      expect.objectContaining({ ruleId: "pure-no-runtime", specifier: "../runtime/adapter.js" }),
      expect.objectContaining({ ruleId: "pure-no-runtime", specifier: "../runtime/lazy.js" }),
      expect.objectContaining({ ruleId: "pure-no-runtime", specifier: "../runtime/value.js" }),
    ]);
  });

  it("honors a narrow edge exception without opening the rest of the scope", () => {
    const violations = analyzeImportBoundaries({
      files: [
        {
          path: "src/pure/allowed.ts",
          source: [
            'import type { RuntimeType } from "../runtime/types.js";',
            'import "../runtime/adapter.js";',
          ].join("\n"),
        },
        { path: "src/runtime/types.ts", source: "export type RuntimeType = string;" },
        { path: "src/runtime/adapter.ts", source: "" },
      ],
      rules: [rule],
    });
    expect(violations).toEqual([
      expect.objectContaining({ resolvedTarget: "src/runtime/adapter.ts" }),
    ]);
  });

  it("fails visibly for unresolved relative imports and reports multiple violations", () => {
    const violations = analyzeImportBoundaries({
      files: [{
        path: "src/pure/a.ts",
        source: ['import "./missing.js";', 'import "node:fs";', 'import "../runtime/adapter.js";'].join("\n"),
      }, { path: "src/runtime/adapter.ts", source: "" }],
      rules: [rule],
    });
    expect(violations.map((violation) => violation.ruleId)).toEqual([
      "pure-no-runtime",
      "pure-no-runtime",
      "unresolved-local-import",
    ]);
  });

  it("fails visibly for a non-literal dynamic import", () => {
    const violations = analyzeImportBoundaries({
      files: [{ path: "src/pure/a.ts", source: "void import(moduleName);" }],
      rules: [rule],
    });
    expect(violations).toEqual([
      expect.objectContaining({
        ruleId: "nonliteral-dynamic-import",
        specifier: "<non-literal>",
      }),
    ]);
  });

  it("checks direct and transitive runtime paths while ignoring type-only edges", () => {
    const transitiveRule: ImportBoundaryRule = {
      id: "planner-pure-closure",
      importers: [{ kind: "exact", value: "src/planner.ts" }],
      deniedExternalSpecifiers: ["node:fs", "node:child_process"],
      transitive: true,
    };
    const violations = analyzeImportBoundaries({
      files: [
        {
          path: "src/planner.ts",
          source: [
            'import { helper } from "./helper.js";',
            'import type { AdapterType } from "./adapter-type.js";',
            'import "node:child_process";',
            "void helper;",
          ].join("\n"),
        },
        { path: "src/helper.ts", source: 'import "node:fs"; export const helper = 1;' },
        {
          path: "src/adapter-type.ts",
          source: 'import "node:fs"; export type AdapterType = string;',
        },
      ],
      rules: [transitiveRule],
    });
    expect(violations.map((violation) => violation.dependencyPath)).toEqual([
      ["src/planner.ts", "node:child_process"],
      ["src/planner.ts", "src/helper.ts", "node:fs"],
    ]);
  });
});

describe("module-map boundary registry", () => {
  it("checks marker completeness, NI reasons, uniqueness, and IB registry parity", () => {
    const valid = [
      "### pure",
      "- 禁止依赖：MUST NOT import runtime。[IB:pure-no-runtime]；MUST NOT write state。[NI:pure-no-state-write]（非 import：需要运行时行为测试）",
    ].join("\n");
    expect(validateBoundaryDocumentation({ markdown: valid, rules: [rule] })).toEqual([]);

    const invalid = [
      "### pure",
      "- 禁止依赖：MUST NOT import runtime。[IB:missing-rule]；MUST NOT write state。[NI:no-reason]",
    ].join("\n");
    expect(validateBoundaryDocumentation({ markdown: invalid, rules: [rule] })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("NI marker must include a non-empty reason"),
        expect.stringContaining("documented IB rule is missing"),
        expect.stringContaining("registry rule is missing"),
      ]),
    );
  });
});

describe("four-layer architecture boundaries", () => {
  it("requires one layer and follows domain runtime imports while ignoring type-only edges", () => {
    const files = [
      { path: "src/domain.ts", source: 'import { helper } from "./helper.js"; import type { Port } from "./adapter.js"; export const decide = () => helper;' },
      { path: "src/helper.ts", source: 'import "node:fs/promises"; export const helper = 1;' },
      { path: "src/adapter.ts", source: 'import "node:fs/promises"; export interface Port {}' },
    ];
    const violations = analyzeFourLayerArchitecture({
      files,
      productionPaths: new Set(files.map((file) => file.path)),
      config: {
        assignments: [
          { layer: "domain", scope: { kind: "exact", value: "src/domain.ts" } },
          { layer: "domain", scope: { kind: "exact", value: "src/helper.ts" } },
          { layer: "adapter", scope: { kind: "exact", value: "src/adapter.ts" } },
        ],
        compositionRoots: [], dependencyDebt: [], fileDebt: [], conditionPermits: [],
      },
    });
    expect(violations).toEqual([
      expect.objectContaining({
        ruleId: "domain-pure-runtime-closure",
        importer: "src/domain.ts",
        line: 1,
        dependencyPath: ["src/domain.ts", "src/helper.ts", "node:fs/promises"],
      }),
      expect.objectContaining({ ruleId: "domain-pure-runtime-closure", importer: "src/helper.ts" }),
    ]);
  });

  it("reports application and adapter business conditions with exact source locations", () => {
    const files = [
      { path: "src/use-case.ts", source: 'export function execute(message: { role: string }) {\n  if (message.role === "qa") return 1;\n  return 0;\n}' },
      { path: "src/adapter.ts", source: 'export function read(record: { role: string; stage: string }) {\n  if (record.role === "qa" && record.stage === "in-progress") return null;\n  return record;\n}' },
    ];
    const violations = analyzeFourLayerArchitecture({
      files,
      productionPaths: new Set(files.map((file) => file.path)),
      config: {
        assignments: [
          { layer: "application", scope: { kind: "exact", value: "src/use-case.ts" } },
          { layer: "adapter", scope: { kind: "exact", value: "src/adapter.ts" } },
        ],
        compositionRoots: [], dependencyDebt: [], fileDebt: [], conditionPermits: [],
      },
    });
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "application-use-case-shape", importer: "src/use-case.ts", line: 2 }),
      expect.objectContaining({ ruleId: "adapter-boundary-branch-total", importer: "src/adapter.ts", line: 2 }),
    ]));
  });

  it("enforces each application shape budget independently", () => {
    const longBody = Array.from({ length: 301 }, (_, index) => `  void ${String(index)};`).join("\n");
    const delegatedConditions = Array.from(
      { length: 12 },
      (_, index) => `  if (decideFlag(values[${String(index)}])) count++;`,
    ).join("\n");
    const files = [
      { path: "src/decision.ts", source: "export function decideFlag(value: boolean | undefined) { return value === true; }" },
      { path: "src/complex.ts", source: `import { decideFlag } from "./decision.js";\nexport function execute(values: boolean[]) {\n  let count = 0;\n${delegatedConditions}\n  return count;\n}` },
      { path: "src/long-use-case.ts", source: `export function execute() {\n${longBody}\n}` },
      { path: "src/long-root.ts", source: `export function execute() {\n${longBody}\n}` },
      { path: "src/multiple.ts", source: "export function executeFirst() {}\nexport function executeSecond() {}" },
    ];
    const violations = analyzeFourLayerArchitecture({
      files,
      productionPaths: new Set(files.map((file) => file.path)),
      config: {
        assignments: [
          { layer: "domain", scope: { kind: "exact", value: "src/decision.ts" } },
          ...["src/complex.ts", "src/long-use-case.ts", "src/long-root.ts", "src/multiple.ts"].map((value) => ({
            layer: "application" as const,
            scope: { kind: "exact" as const, value },
          })),
        ],
        compositionRoots: ["src/long-root.ts"],
        dependencyDebt: [], fileDebt: [], conditionPermits: [],
      },
    });
    expect(violations.map((item) => [item.importer, item.specifier])).toEqual([
      ["src/complex.ts", "<complexity>"],
      ["src/long-root.ts", "<composition-root-lines>"],
      ["src/long-use-case.ts", "<logical-lines>"],
      ["src/multiple.ts", "<exports>"],
    ]);
  });

  it("reports each prohibited layer direction with its stable rule id", () => {
    const files = [
      { path: "src/view.ts", source: 'import { adapter } from "./adapter.js"; export const view = adapter;' },
      { path: "src/use-case.ts", source: 'import { view } from "./view.js"; export const execute = () => view;' },
      { path: "src/adapter.ts", source: 'import { execute } from "./use-case.js"; export const adapter = execute;' },
    ];
    const violations = analyzeFourLayerArchitecture({
      files,
      productionPaths: new Set(files.map((file) => file.path)),
      config: {
        assignments: [
          { layer: "view", scope: { kind: "exact", value: "src/view.ts" } },
          { layer: "application", scope: { kind: "exact", value: "src/use-case.ts" } },
          { layer: "adapter", scope: { kind: "exact", value: "src/adapter.ts" } },
        ],
        compositionRoots: [], dependencyDebt: [], fileDebt: [], conditionPermits: [],
      },
    });
    expect(violations.map((item) => item.ruleId)).toEqual(expect.arrayContaining([
      "view-no-side-effect-adapters",
      "application-no-view-dependency",
      "adapter-no-use-case-reentry",
    ]));
  });

  it("accepts exact live debt and rejects it after the violating edge disappears", () => {
    const config = {
      assignments: [
        { layer: "application" as const, scope: { kind: "exact" as const, value: "src/use-case.ts" } },
        { layer: "adapter" as const, scope: { kind: "exact" as const, value: "src/adapter.ts" } },
      ],
      compositionRoots: [],
      dependencyDebt: [{
        ruleId: "architecture-layer-dependency-matrix" as const,
        importer: "src/use-case.ts", target: "src/adapter.ts", reason: "baseline",
        removalChange: "four-layer-40-adapter-convergence",
      }],
      fileDebt: [], conditionPermits: [],
    };
    const adapter = { path: "src/adapter.ts", source: "export const adapter = 1;" };
    const live = analyzeFourLayerArchitecture({
      files: [{ path: "src/use-case.ts", source: 'import { adapter } from "./adapter.js"; export const execute = () => adapter;' }, adapter],
      productionPaths: new Set(["src/use-case.ts", "src/adapter.ts"]), config,
    });
    expect(live.map((item) => item.ruleId)).not.toContain("architecture-legacy-debt");
    const stale = analyzeFourLayerArchitecture({
      files: [{ path: "src/use-case.ts", source: "export const execute = () => 1;" }, adapter],
      productionPaths: new Set(["src/use-case.ts", "src/adapter.ts"]), config,
    });
    expect(stale).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "architecture-legacy-debt", specifier: "<stale-debt>" }),
    ]));
  });
});
