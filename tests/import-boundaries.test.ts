import { describe, expect, it } from "vitest";

import {
  analyzeImportBoundaries,
  validateBoundaryDocumentation,
  type ImportBoundaryRule,
} from "../src/testing/import-boundaries.js";

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
