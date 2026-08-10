import path from "node:path";
import ts from "typescript";

export interface RepositoryFile {
  path: string;
  source: string;
}

export interface ImportBoundaryScope {
  kind: "exact" | "prefix";
  value: string;
}

export interface ImportBoundaryRule {
  id: string;
  importers: readonly ImportBoundaryScope[];
  deniedRepositoryTargets?: readonly ImportBoundaryScope[];
  deniedExternalSpecifiers?: readonly string[];
  /** Follow runtime imports recursively from each importer before evaluating denied targets. */
  transitive?: boolean;
  allow?: readonly {
    importer: ImportBoundaryScope;
    target: ImportBoundaryScope;
  }[];
}

export interface ImportBoundaryViolation {
  ruleId: string;
  importer: string;
  specifier: string;
  resolvedTarget: string;
  dependencyPath?: string[];
  line?: number;
  detail?: string;
}

export type ArchitectureLayer = "view" | "application" | "domain" | "adapter";

export interface ArchitectureLayerAssignment {
  layer: ArchitectureLayer;
  scope: ImportBoundaryScope;
}

export interface ArchitectureDependencyDebt {
  ruleId:
    | "architecture-layer-dependency-matrix"
    | "domain-pure-runtime-closure"
    | "view-no-side-effect-adapters"
    | "application-no-view-dependency"
    | "adapter-no-use-case-reentry";
  importer: string;
  target: string;
  reason: string;
  removalChange: string;
}

export interface ArchitectureFileDebt {
  ruleId: "application-use-case-shape" | "adapter-boundary-branch-total";
  file: string;
  reason: string;
  removalChange: string;
}

export interface ArchitectureConditionPermit {
  ruleId: "application-use-case-shape" | "adapter-boundary-branch-total";
  file: string;
  exportName: string;
  fingerprint: string;
  kind: "transport-control" | "external-contract";
  contract: string;
}

export interface FourLayerArchitectureConfig {
  assignments: readonly ArchitectureLayerAssignment[];
  compositionRoots: readonly string[];
  dependencyDebt: readonly ArchitectureDependencyDebt[];
  fileDebt: readonly ArchitectureFileDebt[];
  conditionPermits: readonly ArchitectureConditionPermit[];
}

type ResolvedImportTarget =
  | { kind: "repository"; path: string }
  | { kind: "external"; specifier: string };

interface ResolvedImportReference {
  specifier: string;
  runtime: boolean;
  target: ResolvedImportTarget;
  line: number;
}

const exact = (value: string): ImportBoundaryScope => ({ kind: "exact", value });
const prefix = (value: string): ImportBoundaryScope => ({ kind: "prefix", value });

const codexAdapter = [exact("src/codex.ts"), exact("src/codex-rollout.ts")];
const filesystemAdapters = ["node:fs", "node:fs/promises"];
const plannerDeniedTargets = [
  exact("src/local-console/store.ts"),
  exact("src/local-console/t5-store.ts"),
  exact("src/local-console/execution-driver.ts"),
  exact("src/sqlite-state.ts"),
  exact("src/sqlite-state-worker.ts"),
  exact("src/codex.ts"),
  exact("src/kimi.ts"),
  exact("src/claude.ts"),
];
const plannerDeniedExternals = [
  ...filesystemAdapters,
  "node:sqlite",
  "node:child_process",
];

export const IMPORT_BOUNDARY_RULES: readonly ImportBoundaryRule[] = [
  {
    id: "console-ui-no-runtime-internals",
    importers: [prefix("packages/console-ui/src/")],
    deniedRepositoryTargets: [
      exact("src/runner.ts"),
      prefix("src/local-console/"),
    ],
  },
  {
    id: "console-ui-no-side-effect-adapters",
    importers: [prefix("packages/console-ui/src/")],
    deniedRepositoryTargets: codexAdapter,
    deniedExternalSpecifiers: ["node:child_process"],
  },
  {
    id: "local-control-planner-pure-closure",
    importers: [exact("src/local-console/control-dispatch.ts")],
    deniedRepositoryTargets: plannerDeniedTargets,
    deniedExternalSpecifiers: plannerDeniedExternals,
    transitive: true,
  },
  {
    id: "local-handoff-runtime-pure-orchestration",
    importers: [exact("src/local-console/handoff-dispatch-runtime.ts")],
    deniedRepositoryTargets: plannerDeniedTargets,
    deniedExternalSpecifiers: plannerDeniedExternals,
    transitive: true,
  },
  {
    id: "local-invocation-planner-pure-closure",
    importers: [exact("src/local-console/run-invocation-plan.ts")],
    deniedRepositoryTargets: plannerDeniedTargets,
    deniedExternalSpecifiers: plannerDeniedExternals,
    transitive: true,
  },
  {
    id: "stages-no-side-effect-adapters",
    importers: [exact("src/stages.ts")],
    deniedRepositoryTargets: codexAdapter,
    deniedExternalSpecifiers: filesystemAdapters,
  },
  {
    id: "ceo-scripts-no-provider-adapters",
    importers: [exact("src/ceo-scripts.ts")],
    deniedRepositoryTargets: codexAdapter,
  },
  {
    id: "local-ceo-orchestration-no-side-effect-adapters",
    importers: [exact("src/local-console/ceo-orchestration-parser.ts")],
    deniedRepositoryTargets: codexAdapter,
    deniedExternalSpecifiers: [...filesystemAdapters, "node:child_process"],
  },
  {
    id: "triggers-no-side-effect-adapters",
    importers: [prefix("src/triggers/")],
    deniedRepositoryTargets: codexAdapter,
    deniedExternalSpecifiers: filesystemAdapters,
  },
  {
    id: "local-config-no-provider-adapters",
    importers: [exact("src/local-config.ts")],
    deniedRepositoryTargets: codexAdapter,
  },
  {
    id: "conversation-no-side-effect-adapters",
    importers: [exact("src/conversation.ts")],
    deniedRepositoryTargets: codexAdapter,
    deniedExternalSpecifiers: filesystemAdapters,
  },
] as const;

export function analyzeImportBoundaries(input: {
  files: readonly RepositoryFile[];
  knownPaths?: ReadonlySet<string>;
  rules?: readonly ImportBoundaryRule[];
}): ImportBoundaryViolation[] {
  const sourceFiles = new Map(input.files.map((file) => [normalize(file.path), file.source]));
  const knownPaths = new Set([
    ...sourceFiles.keys(),
    ...[...(input.knownPaths ?? [])].map(normalize),
  ]);
  const violations: ImportBoundaryViolation[] = [];
  const resolvedImports = new Map<string, ResolvedImportReference[]>();

  for (const [importer, source] of sourceFiles) {
    const imports = collectModuleSpecifiers(importer, source);
    for (let index = 0; index < imports.nonLiteralDynamicImports; index += 1) {
      violations.push({
        ruleId: "nonliteral-dynamic-import",
        importer,
        specifier: "<non-literal>",
        resolvedTarget: "<unresolved>",
      });
    }
    const references: ResolvedImportReference[] = [];
    for (const reference of imports.references) {
      const target = resolveSpecifier(importer, reference.specifier, knownPaths);
      if (target.kind === "unresolved") {
        violations.push({
          ruleId: "unresolved-local-import",
          importer,
          specifier: reference.specifier,
          resolvedTarget: "<unresolved>",
          line: reference.line,
        });
        continue;
      }
      references.push({ ...reference, target });
      for (const rule of input.rules ?? IMPORT_BOUNDARY_RULES) {
        if (rule.transitive === true) continue;
        if (!matchesAny(importer, rule.importers)) continue;
        if (!isDeniedTarget(target, rule) || isAllowedEdge(importer, target, rule)) continue;
        violations.push({
          ruleId: rule.id,
          importer,
          specifier: reference.specifier,
          resolvedTarget: target.kind === "repository" ? target.path : target.specifier,
          line: reference.line,
        });
      }
    }
    resolvedImports.set(importer, references);
  }

  for (const rule of input.rules ?? IMPORT_BOUNDARY_RULES) {
    if (rule.transitive !== true) continue;
    for (const importer of sourceFiles.keys()) {
      if (!matchesAny(importer, rule.importers)) continue;
      violations.push(...findTransitiveViolations(importer, rule, resolvedImports));
    }
  }

  return violations.sort((left, right) =>
    `${left.ruleId}:${left.importer}:${left.specifier}`.localeCompare(
      `${right.ruleId}:${right.importer}:${right.specifier}`,
    ));
}

export function validateBoundaryDocumentation(input: {
  markdown: string;
  rules?: readonly ImportBoundaryRule[];
  additionalRuleIds?: readonly string[];
}): string[] {
  const errors: string[] = [];
  const ids = new Map<string, number>();
  const documentedImportRules = new Set<string>();
  const headings = [...input.markdown.matchAll(/^### (.+)$/gmu)].map((match) => match[1]!);
  const prohibitionLines = [...input.markdown.matchAll(/^- 禁止依赖：(.*)$/gmu)];
  if (headings.length !== prohibitionLines.length) {
    errors.push(`module headings (${String(headings.length)}) and prohibition sections (${String(prohibitionLines.length)}) differ`);
  }

  for (const match of prohibitionLines) {
    const line = match[1]!;
    const clauses = line.split("；").map((clause) => clause.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (!/(?:MUST NOT|不得|只允许)/u.test(clause)) continue;
      const markers = [...clause.matchAll(/\[(IB|NI):([a-z0-9-]+)\]/gu)];
      if (markers.length !== 1) {
        errors.push(`prohibition clause must have exactly one IB/NI marker: ${clause}`);
        continue;
      }
      const [, kind, id] = markers[0]!;
      ids.set(id!, (ids.get(id!) ?? 0) + 1);
      if (kind === "IB") documentedImportRules.add(id!);
      if (kind === "NI" && !new RegExp(`\\[NI:${id}\\]（非 import：[^）]+）`, "u").test(clause)) {
        errors.push(`NI marker must include a non-empty reason: ${id}`);
      }
    }
  }

  for (const [id, count] of ids) {
    if (count !== 1) errors.push(`boundary marker must be unique: ${id} appears ${String(count)} times`);
  }
  const registryIds = new Set([
    ...(input.rules ?? IMPORT_BOUNDARY_RULES).map((rule) => rule.id),
    ...(input.additionalRuleIds ?? []),
  ]);
  for (const id of documentedImportRules) {
    if (!registryIds.has(id)) errors.push(`documented IB rule is missing from registry: ${id}`);
  }
  for (const id of registryIds) {
    if (!documentedImportRules.has(id)) errors.push(`registry rule is missing from module-map: ${id}`);
  }
  return errors;
}

function collectModuleSpecifiers(
  filePath: string,
  source: string,
): {
  references: Array<{ specifier: string; runtime: boolean; line: number }>;
  nonLiteralDynamicImports: number;
} {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: Array<{ specifier: string; runtime: boolean; line: number }> = [];
  let nonLiteralDynamicImports = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        runtime: ts.isImportDeclaration(node)
          ? isRuntimeImportDeclaration(node)
          : isRuntimeExportDeclaration(node),
        line: sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile)).line + 1,
      });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
        references.push({
          specifier: node.arguments[0]!.text,
          runtime: true,
          line: sourceFile.getLineAndCharacterOfPosition(node.arguments[0]!.getStart(sourceFile)).line + 1,
        });
      } else {
        nonLiteralDynamicImports += 1;
      }
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({
        specifier: node.argument.literal.text,
        runtime: false,
        line: sourceFile.getLineAndCharacterOfPosition(node.argument.literal.getStart(sourceFile)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { references, nonLiteralDynamicImports };
}

function isRuntimeImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  return ts.isNamespaceImport(bindings)
    || bindings.elements.some((element) => !element.isTypeOnly);
}

function isRuntimeExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (node.exportClause === undefined || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function findTransitiveViolations(
  importer: string,
  rule: ImportBoundaryRule,
  resolvedImports: ReadonlyMap<string, readonly ResolvedImportReference[]>,
): ImportBoundaryViolation[] {
  const violations: ImportBoundaryViolation[] = [];
  const visited = new Set<string>();
  const visit = (current: string, dependencyPath: string[]): void => {
    if (visited.has(current)) return;
    visited.add(current);
    for (const reference of resolvedImports.get(current) ?? []) {
      if (!reference.runtime) continue;
      const target = reference.target;
      if (isDeniedTarget(target, rule) && !isAllowedEdge(current, target, rule)) {
        const targetLabel = target.kind === "repository" ? target.path : target.specifier;
        violations.push({
          ruleId: rule.id,
          importer,
          specifier: reference.specifier,
          resolvedTarget: targetLabel,
          dependencyPath: [...dependencyPath, targetLabel],
          line: reference.line,
        });
        continue;
      }
      if (target.kind === "repository") {
        visit(target.path, [...dependencyPath, target.path]);
      }
    }
  };
  visit(importer, [importer]);
  return violations;
}

function isDeniedTarget(target: ResolvedImportTarget, rule: ImportBoundaryRule): boolean {
  return target.kind === "repository"
    ? matchesAny(target.path, rule.deniedRepositoryTargets ?? [])
    : (rule.deniedExternalSpecifiers ?? []).includes(target.specifier);
}

function isAllowedEdge(
  importer: string,
  target: ResolvedImportTarget,
  rule: ImportBoundaryRule,
): boolean {
  return target.kind === "repository" && (rule.allow?.some((edge) =>
    matches(importer, edge.importer) && matches(target.path, edge.target)) ?? false);
}

function resolveSpecifier(
  importer: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
):
  | { kind: "repository"; path: string }
  | { kind: "external"; specifier: string }
  | { kind: "unresolved" } {
  let base: string | null = null;
  if (specifier.startsWith(".")) {
    base = normalize(path.posix.join(path.posix.dirname(importer), specifier));
  } else if (specifier.startsWith("@/") && importer.startsWith("packages/console-ui/src/")) {
    base = `packages/console-ui/src/${specifier.slice(2)}`;
  } else if (specifier === "@moebius/console-ui") {
    base = "packages/console-ui/src/index";
  } else if (specifier === "@moebius/console-ui/globals.css") {
    base = "packages/console-ui/src/styles/globals.css";
  } else if (specifier === "@moebius/console-ui/tokens.css") {
    base = "packages/console-ui/src/styles/tokens.css";
  } else if (specifier.startsWith("@moebius/console-ui/")) {
    base = `packages/console-ui/src/${specifier.slice("@moebius/console-ui/".length)}`;
  } else {
    return { kind: "external", specifier };
  }

  for (const candidate of resolutionCandidates(base)) {
    if (knownPaths.has(candidate)) return { kind: "repository", path: candidate };
  }
  return { kind: "unresolved" };
}

function resolutionCandidates(base: string): string[] {
  const withoutJs = base.replace(/\.(?:mjs|cjs|js)$/u, "");
  return [...new Set([
    base,
    withoutJs,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}.mts`,
    `${withoutJs}.cts`,
    `${withoutJs}.js`,
    `${withoutJs}.jsx`,
    `${withoutJs}.json`,
    `${withoutJs}.css`,
    `${withoutJs}/index.ts`,
    `${withoutJs}/index.tsx`,
  ].map(normalize))];
}

function matchesAny(value: string, scopes: readonly ImportBoundaryScope[]): boolean {
  return scopes.some((scope) => matches(value, scope));
}

function matches(value: string, scope: ImportBoundaryScope): boolean {
  return scope.kind === "exact" ? value === scope.value : value.startsWith(scope.value);
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
