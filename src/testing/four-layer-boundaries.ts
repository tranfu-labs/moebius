import path from "node:path";
import ts from "typescript";

import type {
  ArchitectureConditionPermit,
  ArchitectureDependencyDebt,
  ArchitectureFileDebt,
  ArchitectureLayer,
  FourLayerArchitectureConfig,
  ImportBoundaryScope,
  ImportBoundaryViolation,
  RepositoryFile,
} from "./import-boundaries.js";

interface Edge {
  specifier: string;
  runtime: boolean;
  line: number;
  target: { kind: "repository"; path: string } | { kind: "external"; specifier: string };
}

const sideEffects = ["electron", "node:child_process", "node:fs", "node:fs/promises", "node:http", "node:https", "node:sqlite"];
const removalChanges = new Set([
  "four-layer-10-local-console",
  "four-layer-20-desktop-renderer",
  "four-layer-30-github-runner",
  "four-layer-40-adapter-convergence",
]);

export function analyzeFourLayerArchitecture(input: {
  files: readonly RepositoryFile[];
  productionPaths: ReadonlySet<string>;
  knownPaths?: ReadonlySet<string>;
  config: FourLayerArchitectureConfig;
}): ImportBoundaryViolation[] {
  const files = new Map(input.files.map((file) => [norm(file.path), file.source]));
  const production = new Set([...input.productionPaths].map(norm));
  const known = new Set([...files.keys(), ...[...(input.knownPaths ?? [])].map(norm)]);
  const config = normalizeConfig(input.config);
  const layers = new Map<string, ArchitectureLayer>();
  const violations: ImportBoundaryViolation[] = [];

  for (const file of [...production].sort()) {
    const matches = config.assignments.filter((entry) => scopeMatches(file, entry.scope));
    if (!files.has(file) || matches.length !== 1) {
      violations.push(v("architecture-layer-assignment-total", file, 1, "<layer>", matches.length === 0 ? "<unassigned>" : matches.map((item) => item.layer).join(","), matches.length > 1 ? "multiple layer assignments" : "missing layer assignment or source"));
    } else {
      layers.set(file, matches[0]!.layer);
    }
  }
  for (const assignment of config.assignments) {
    if (![...production].some((file) => scopeMatches(file, assignment.scope))) {
      violations.push(v("architecture-layer-assignment-total", assignment.scope.value, 1, "<stale-scope>", assignment.layer, "layer scope matches no production file"));
    }
  }

  const roots = new Set(config.compositionRoots);
  for (const root of roots) {
    if (layers.get(root) !== "application") violations.push(v("composition-root-narrow-allowlist", root, 1, "<root>", layers.get(root) ?? "<missing>", "composition root must be an exact application file"));
  }

  const graph = new Map<string, Edge[]>();
  for (const [file, source] of files) graph.set(file, importsOf(file, source, known));
  const rawDependencies: ImportBoundaryViolation[] = [];
  for (const [file, layer] of layers) {
    for (const edge of graph.get(file) ?? []) {
      if (!edge.runtime) continue;
      if (edge.target.kind === "external") {
        if (layer !== "adapter" && layer !== "domain" && isSideEffect(edge.target.specifier) && !(layer === "application" && roots.has(file))) {
          rawDependencies.push(v(layer === "view" ? "view-no-side-effect-adapters" : "architecture-layer-dependency-matrix", file, edge.line, edge.specifier, edge.target.specifier, `${layer} reaches a concrete side-effect runtime`));
        }
        continue;
      }
      const targetLayer = layers.get(edge.target.path);
      if (targetLayer === undefined || layer === "domain" && targetLayer === "adapter") continue;
      if (!allowed(layer, targetLayer, roots.has(file))) rawDependencies.push(v(layer === "view" ? "view-no-side-effect-adapters" : layer === "application" && targetLayer === "view" ? "application-no-view-dependency" : layer === "adapter" && targetLayer === "application" ? "adapter-no-use-case-reentry" : "architecture-layer-dependency-matrix", file, edge.line, edge.specifier, edge.target.path, `${layer} cannot depend on ${targetLayer}`));
    }
  }
  for (const [file, layer] of layers) if (layer === "domain") rawDependencies.push(...domainClosure(file, layers, graph));
  violations.push(...applyDependencyDebt(rawDependencies, config.dependencyDebt));

  const rawFiles: ImportBoundaryViolation[] = [];
  const observedPermits = new Set<string>();
  for (const [file, layer] of layers) {
    const source = files.get(file)!;
    const result = roots.has(file)
      ? compositionRootShape(file, source)
      : layer === "application"
      ? applicationShape(file, source, known, layers, config.conditionPermits)
      : layer === "adapter"
        ? adapterShape(file, source, config.conditionPermits)
        : { violations: [], permits: new Set<string>() };
    rawFiles.push(...result.violations);
    result.permits.forEach((key) => observedPermits.add(key));
  }
  violations.push(...applyFileDebt(rawFiles, config.fileDebt, layers));
  for (const permit of config.conditionPermits) if (!observedPermits.has(permitKey(permit))) violations.push(v(permit.ruleId, permit.file, 1, "<stale-permit>", permit.fingerprint, `stale ${permit.kind} permit (${permit.contract})`));

  return unique(violations).sort((a, b) => `${a.ruleId}:${a.importer}:${a.line ?? 0}:${a.specifier}`.localeCompare(`${b.ruleId}:${b.importer}:${b.line ?? 0}:${b.specifier}`));
}

function compositionRootShape(file: string, source: string) {
  const logicalLines = source.split(/\r?\n/u).filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length;
  const violations = logicalLines > 300
    ? [v("application-use-case-shape", file, 1, "<composition-root-lines>", String(logicalLines), "composition root exceeds 300 logical lines and is not narrow")]
    : [];
  return { violations, permits: new Set<string>() };
}

function applicationShape(file: string, source: string, known: ReadonlySet<string>, layers: ReadonlyMap<string, ArchitectureLayer>, permits: readonly ArchitectureConditionPermit[]) {
  const sf = parse(file, source);
  const conditions = conditionNodes(sf);
  const violations: ImportBoundaryViolation[] = [];
  const runtimeExports = sf.statements.flatMap((statement) => runtimeExportNames(statement));
  const logicalLines = source.split(/\r?\n/u).filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length;
  if (runtimeExports.length !== 1) violations.push(v("application-use-case-shape", file, 1, "<exports>", String(runtimeExports.length), "application file must expose exactly one runtime use case"));
  if (logicalLines > 300) violations.push(v("application-use-case-shape", file, 1, "<logical-lines>", String(logicalLines), "application use case exceeds 300 logical lines"));
  if (conditions.length + 1 > 12) violations.push(v("application-use-case-shape", file, 1, "<complexity>", String(conditions.length + 1), "application use case exceeds complexity 12"));
  const decisions = domainDecisions(sf, file, known, layers);
  const results = decisionResults(sf, decisions);
  const observed = new Set<string>();
  for (const condition of conditions) {
    const fingerprint = fp(condition.node.getText(sf));
    const permit = permits.find((item) => item.ruleId === "application-use-case-shape" && item.file === file && item.exportName === condition.owner && fp(item.fingerprint) === fingerprint);
    if (permit !== undefined) observed.add(permitKey(permit));
    const text = condition.node.getText(sf);
    const delegated = [...decisions].some((name) => text.includes(`${name}(`)) || [...results].some((name) => new RegExp(`\\b${name}\\b`, "u").test(text));
    if (permit === undefined && !delegated) violations.push(v("application-use-case-shape", file, condition.line, fingerprint, "<undelegated>", "condition must dispatch a domain decide*/plan* result or exact transport permit"));
  }
  return { violations, permits: observed };
}

function adapterShape(file: string, source: string, permits: readonly ArchitectureConditionPermit[]) {
  const sf = parse(file, source);
  const violations: ImportBoundaryViolation[] = [];
  const observed = new Set<string>();
  for (const condition of conditionNodes(sf)) {
    const fingerprint = fp(condition.node.getText(sf));
    const permit = permits.find((item) => item.ruleId === "adapter-boundary-branch-total" && item.file === file && item.exportName === condition.owner && fp(item.fingerprint) === fingerprint);
    if (permit !== undefined) observed.add(permitKey(permit));
    if (permit === undefined && !codecGuard(fingerprint) && !transportControl(condition.node)) violations.push(v("adapter-boundary-branch-total", file, condition.line, fingerprint, "<unclassified>", "adapter condition is not codec/transport control and has no exact protocol permit"));
  }
  return { violations, permits: observed };
}

function domainClosure(start: string, layers: ReadonlyMap<string, ArchitectureLayer>, graph: ReadonlyMap<string, readonly Edge[]>): ImportBoundaryViolation[] {
  const out: ImportBoundaryViolation[] = [];
  const visited = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const edge of graph.get(file) ?? []) {
      if (!edge.runtime) continue;
      if (edge.target.kind === "external") {
        if (isSideEffect(edge.target.specifier)) out.push({ ...v("domain-pure-runtime-closure", start, edge.line, edge.specifier, edge.target.specifier, "domain closure reaches side-effect runtime"), dependencyPath: [...chain, edge.target.specifier] });
      } else if (layers.get(edge.target.path) === "adapter") {
        out.push({ ...v("domain-pure-runtime-closure", start, edge.line, edge.specifier, edge.target.path, "domain closure reaches adapter"), dependencyPath: [...chain, edge.target.path] });
      } else if (layers.get(edge.target.path) === "domain") walk(edge.target.path, [...chain, edge.target.path]);
    }
  };
  walk(start, [start]);
  return out;
}

function applyDependencyDebt(raw: readonly ImportBoundaryViolation[], debts: readonly ArchitectureDependencyDebt[]) {
  const out = [...raw];
  const seen = new Set<string>();
  for (const debt of debts) {
    const key = `${debt.ruleId}:${debt.importer}:${debt.target}`;
    if (seen.has(key) || debt.importer.includes("*") || debt.target.includes("*") || debt.reason.trim() === "" || !removalChanges.has(debt.removalChange)) { out.push(v("architecture-legacy-debt", debt.importer, 1, "<invalid-debt>", debt.target, "debt must be unique, exact, reasoned, and bound to a change")); continue; }
    seen.add(key);
    const count = out.filter((item) => item.ruleId === debt.ruleId && item.importer === debt.importer && item.resolvedTarget === debt.target).length;
    if (count === 0) out.push(v("architecture-legacy-debt", debt.importer, 1, "<stale-debt>", debt.target, "debt no longer matches a violation"));
    else for (let i = out.length - 1; i >= 0; i -= 1) if (out[i]!.ruleId === debt.ruleId && out[i]!.importer === debt.importer && out[i]!.resolvedTarget === debt.target) out.splice(i, 1);
  }
  return out;
}

function applyFileDebt(raw: readonly ImportBoundaryViolation[], debts: readonly ArchitectureFileDebt[], layers: ReadonlyMap<string, ArchitectureLayer>) {
  const out = [...raw];
  const seen = new Set<string>();
  for (const debt of debts) {
    const expected = debt.ruleId === "application-use-case-shape" ? "application" : "adapter";
    const key = `${debt.ruleId}:${debt.file}`;
    if (seen.has(key) || debt.file.includes("*") || debt.reason.trim() === "" || !removalChanges.has(debt.removalChange) || layers.get(debt.file) !== expected) { out.push(v("architecture-legacy-debt", debt.file, 1, "<invalid-file-debt>", debt.ruleId, "file debt must be exact and bound to its assigned layer/change")); continue; }
    seen.add(key);
    const count = out.filter((item) => item.ruleId === debt.ruleId && item.importer === debt.file).length;
    if (count === 0) out.push(v("architecture-legacy-debt", debt.file, 1, "<stale-file-debt>", debt.ruleId, "file debt no longer matches a violation"));
    else for (let i = out.length - 1; i >= 0; i -= 1) if (out[i]!.ruleId === debt.ruleId && out[i]!.importer === debt.file) out.splice(i, 1);
  }
  return out;
}

function importsOf(file: string, source: string, known: ReadonlySet<string>): Edge[] {
  const sf = parse(file, source);
  const out: Edge[] = [];
  const add = (specifier: string, runtime: boolean, node: ts.Node) => {
    const target = resolve(file, specifier, known);
    if (target !== undefined) out.push({ specifier, runtime, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, target });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier.text, runtimeImport(node), node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) add(node.moduleSpecifier.text, !node.isTypeOnly, node.moduleSpecifier);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) add(node.arguments[0]!.text, true, node.arguments[0]!);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function conditionNodes(sf: ts.SourceFile): Array<{ node: ts.Expression; line: number; owner: string }> {
  const out: Array<{ node: ts.Expression; line: number; owner: string }> = [];
  const add = (node: ts.Expression) => out.push({ node, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, owner: owner(node) });
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) add(node.expression);
    else if (ts.isConditionalExpression(node)) add(node.condition);
    else if (ts.isForStatement(node) && node.condition !== undefined) add(node.condition);
    else if (ts.isCaseClause(node)) add(node.expression);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) add(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function owner(node: ts.Node): string {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) return current.parent.name.text;
    if (ts.isMethodDeclaration(current)) return current.name.getText();
  }
  return "<module>";
}

function runtimeExportNames(statement: ts.Statement): string[] {
  if (!ts.canHaveModifiers(statement) || !(ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) ?? false)) return [];
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) return [statement.name.text];
  if (ts.isEnumDeclaration(statement)) return [statement.name.text];
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.filter((item) => item.initializer !== undefined && ts.isIdentifier(item.name)).map((item) => (item.name as ts.Identifier).text);
  return [];
}

function domainDecisions(sf: ts.SourceFile, file: string, known: ReadonlySet<string>, layers: ReadonlyMap<string, ArchitectureLayer>): Set<string> {
  const out = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly === true || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const target = resolve(file, statement.moduleSpecifier.text, known);
    if (target?.kind !== "repository" || layers.get(target.path) !== "domain") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) for (const item of bindings.elements) if (!item.isTypeOnly && /^(decide|plan)/u.test(item.propertyName?.text ?? item.name.text)) out.add(item.name.text);
  }
  return out;
}

function decisionResults(sf: ts.SourceFile, decisions: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && decisions.has(node.initializer.expression.text)) out.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function codecGuard(text: string) { return /\btypeof\b|(?:===|!==|==|!=)\s*(?:null|undefined)\b|Array\.isArray\s*\(|Number\.(?:isFinite|isInteger)\s*\(|\binstanceof\b|\.length\s*(?:===|!==|==|!=|<=|>=|<|>)\s*\d+/u.test(text); }
function transportControl(node: ts.Node) {
  const businessSymbols = /(?:acceptance|agent|assignee|conversation|goal|handoff|member|mention|milestone|owner|priority|project|role|session|stage|task|team|trigger)/iu;
  const symbols = new Set<string>();
  const visit = (item: ts.Node) => { if (ts.isIdentifier(item)) symbols.add(item.text); ts.forEachChild(item, visit); };
  visit(node);
  return symbols.size > 0 && ![...symbols].some((item) => businessSymbols.test(item));
}

function runtimeImport(node: ts.ImportDeclaration) { const clause = node.importClause; if (clause === undefined) return true; if (clause.isTypeOnly) return false; if (clause.name !== undefined) return true; const bindings = clause.namedBindings; return bindings !== undefined && (ts.isNamespaceImport(bindings) || bindings.elements.some((item) => !item.isTypeOnly)); }
function allowed(from: ArchitectureLayer, to: ArchitectureLayer, root: boolean) { if (from === "view") return to === "view" || to === "domain"; if (from === "application") return to === "application" || to === "domain" || root && (to === "view" || to === "adapter"); if (from === "domain") return to === "domain"; return to === "adapter" || to === "domain"; }
function isSideEffect(specifier: string) { return sideEffects.some((item) => specifier === item || specifier.startsWith(`${item}/`)); }
function scopeMatches(file: string, scope: ImportBoundaryScope) { return scope.kind === "exact" ? file === scope.value : file.startsWith(scope.value); }
function parse(file: string, source: string) { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function norm(value: string) { return value.replaceAll("\\", "/").replace(/^\.\//u, ""); }
function fp(value: string) { return value.replace(/\s+/gu, " ").trim(); }
function permitKey(item: ArchitectureConditionPermit) { return `${item.ruleId}:${norm(item.file)}:${item.exportName}:${fp(item.fingerprint)}`; }
function normalizeConfig(config: FourLayerArchitectureConfig): FourLayerArchitectureConfig { return { assignments: config.assignments.map((item) => ({ layer: item.layer, scope: { ...item.scope, value: norm(item.scope.value) } })), compositionRoots: config.compositionRoots.map(norm), dependencyDebt: config.dependencyDebt.map((item) => ({ ...item, importer: norm(item.importer), target: norm(item.target) })), fileDebt: config.fileDebt.map((item) => ({ ...item, file: norm(item.file) })), conditionPermits: config.conditionPermits.map((item) => ({ ...item, file: norm(item.file), fingerprint: fp(item.fingerprint) })) }; }
function resolve(importer: string, specifier: string, known: ReadonlySet<string>): Edge["target"] | undefined { let base: string; if (specifier.startsWith(".")) base = norm(path.posix.join(path.posix.dirname(importer), specifier)); else if (specifier.startsWith("@/") && importer.startsWith("packages/console-ui/src/")) base = `packages/console-ui/src/${specifier.slice(2)}`; else if (specifier === "@moebius/console-ui") base = "packages/console-ui/src/index"; else if (specifier.startsWith("@moebius/console-ui/")) base = `packages/console-ui/src/${specifier.slice("@moebius/console-ui/".length)}`; else return { kind: "external", specifier }; const noJs = base.replace(/\.(mjs|cjs|js)$/u, ""); for (const candidate of [base, noJs, `${noJs}.ts`, `${noJs}.tsx`, `${noJs}.mts`, `${noJs}.cts`, `${noJs}.js`, `${noJs}.json`, `${noJs}.css`, `${noJs}/index.ts`, `${noJs}/index.tsx`].map(norm)) if (known.has(candidate)) return { kind: "repository", path: candidate }; return undefined; }
function v(ruleId: string, importer: string, line: number, specifier: string, resolvedTarget: string, detail: string): ImportBoundaryViolation { return { ruleId, importer, line, specifier, resolvedTarget, detail }; }
function unique(items: readonly ImportBoundaryViolation[]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.ruleId}:${item.importer}:${item.line ?? 0}:${item.specifier}:${item.resolvedTarget}:${item.dependencyPath?.join("->") ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
