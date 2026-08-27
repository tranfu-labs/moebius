import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LAYER_TOKEN_REGISTRY = {
  "layer-underlay": -1,
  "layer-base": 0,
  "layer-local-low": 1,
  "layer-local-mid": 2,
  "layer-local-high": 3,
  "layer-content": 10,
  "layer-rail": 20,
  "layer-panel": 30,
  "layer-floating-local": 40,
  "layer-floating": 50,
  "layer-drawer": 60,
  "layer-app-chrome": 80,
  "layer-app-notice": 90,
  "layer-modal-backdrop": 100,
  "layer-modal": 101,
  "layer-system-backdrop": 110,
  "layer-system": 111,
  "layer-system-nested": 120,
} as const;

export type ZIndexViolation = {
  file: string;
  line: number;
  message: string;
  source: string;
};

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TOKEN_FILE_PATHS = [
  "packages/console-ui/src/styles/tokens.css",
  "prototypes/src/layer-tokens.css",
];
const LAYER_TOKEN_MIRROR_PREFIXES = [
  "sites/marketeam/",
  "docs/design-explorations/marketing-site/",
  "docs/marketing-site/archive/",
  "docs/product/pages/",
  "docs/product/flows/",
];
const SCAN_ROOTS = [
  "src",
  "desktop",
  "packages/console-ui/src",
  "packages/console-ui/.storybook",
  "prototypes/src",
  "sites/marketeam",
  "docs",
  "tests",
];
const SOURCE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".html", ".tsx", ".jsx", ".ts", ".js"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".cache",
  "node_modules",
  "dist",
  "coverage",
  "artifacts",
  "storybook-static",
]);

const RAW_TAILWIND_Z_INDEX = /(?:^|[\s"'`. :])(-?z-(?:\[[^\]\r\n]+\]|-?\d+))(?![A-Za-z0-9_-])/gm;
const CSS_Z_INDEX_DECLARATION = /\bz-index\s*:\s*([^;}\r\n]+)/gi;
const NUMERIC_JS_Z_INDEX = /\bzIndex\s*[:=]\s*(?:"(-?\d+(?:\.\d+)?)"|'(-?\d+(?:\.\d+)?)'|(-?\d+(?:\.\d+)?))/g;
const LAYER_REFERENCE = /var\(--(layer-[a-z0-9-]+)\)/g;
const LAYER_DECLARATION = /--(layer-[a-z0-9-]+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=;|})/g;

function lineNumber(contents: string, index: number): number {
  return contents.slice(0, index).split("\n").length;
}

function addViolation(
  violations: ZIndexViolation[],
  file: string,
  contents: string,
  index: number,
  message: string,
  source: string,
): void {
  violations.push({ file, line: lineNumber(contents, index), message, source: source.trim() });
}

export function parseLayerTokenDeclarations(contents: string): Map<string, number> {
  const declarations = new Map<string, number>();
  for (const match of contents.matchAll(LAYER_DECLARATION)) {
    declarations.set(match[1], Number(match[2]));
  }
  return declarations;
}

export function validateLayerTokenDeclarations(file: string, contents: string): ZIndexViolation[] {
  const violations: ZIndexViolation[] = [];
  const declarations = parseLayerTokenDeclarations(contents);

  for (const [token, expectedValue] of Object.entries(LAYER_TOKEN_REGISTRY)) {
    const actualValue = declarations.get(token);
    if (actualValue === undefined || actualValue !== expectedValue) {
      addViolation(
        violations,
        file,
        contents,
        0,
        `layer token --${token} must be ${expectedValue}`,
        `--${token}: ${actualValue ?? "missing"}`,
      );
    }
  }

  for (const token of declarations.keys()) {
    if (!(token in LAYER_TOKEN_REGISTRY)) {
      const index = contents.indexOf(`--${token}`);
      addViolation(violations, file, contents, index, `unknown layer token --${token}`, `--${token}`);
    }
  }

  return violations;
}

export function findZIndexViolations(file: string, contents: string): ZIndexViolation[] {
  const violations: ZIndexViolation[] = [];

  for (const match of contents.matchAll(RAW_TAILWIND_Z_INDEX)) {
    const source = match[1] ?? match[0];
    const index = (match.index ?? 0) + match[0].length - source.length;
    addViolation(violations, file, contents, index, "numeric or arbitrary Tailwind z-index is forbidden", source);
  }

  for (const match of contents.matchAll(CSS_Z_INDEX_DECLARATION)) {
    const value = match[1].trim();
    const allowedKeyword = /^(auto|inherit|initial|unset|revert|revert-layer)$/i.test(value);
    const allowedToken = /^var\(--layer-[a-z0-9-]+\)$/i.test(value);
    if (!allowedKeyword && !allowedToken) {
      addViolation(violations, file, contents, match.index ?? 0, "CSS z-index must use auto or a layer token", match[0]);
    }
  }

  for (const match of contents.matchAll(NUMERIC_JS_Z_INDEX)) {
    addViolation(violations, file, contents, match.index ?? 0, "numeric JavaScript zIndex is forbidden", match[0]);
  }

  for (const match of contents.matchAll(LAYER_REFERENCE)) {
    if (!(match[1] in LAYER_TOKEN_REGISTRY)) {
      addViolation(violations, file, contents, match.index ?? 0, `unknown layer token --${match[1]}`, match[0]);
    }
  }

  return violations;
}

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(extname(root)) ? [root] : [];

  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    files.push(...collectFiles(resolve(root, entry.name)));
  }
  return files;
}

export function collectZIndexSourceFiles(workspaceRoot = WORKSPACE_ROOT): string[] {
  return [...new Set(SCAN_ROOTS.flatMap((root) => collectFiles(resolve(workspaceRoot, root))))].sort();
}

function collectLayerTokenMirrorFiles(workspaceRoot: string): string[] {
  return collectZIndexSourceFiles(workspaceRoot).filter((file) => {
    const relativeFile = relative(workspaceRoot, file);
    return (
      LAYER_TOKEN_MIRROR_PREFIXES.some((prefix) => relativeFile.startsWith(prefix)) &&
      extname(file) === ".html" &&
      readFileSync(file, "utf8").includes("--layer-underlay")
    );
  });
}

export function checkZIndexContract(workspaceRoot = WORKSPACE_ROOT): ZIndexViolation[] {
  const tokenFiles = [
    ...TOKEN_FILE_PATHS.map((tokenFilePath) => resolve(workspaceRoot, tokenFilePath)),
    ...collectLayerTokenMirrorFiles(workspaceRoot),
  ];
  const tokenViolations = [...new Set(tokenFiles)].flatMap((tokenFile) =>
    validateLayerTokenDeclarations(tokenFile, readFileSync(tokenFile, "utf8")),
  );
  const sourceViolations = collectZIndexSourceFiles(workspaceRoot).flatMap((file) => {
    const contents = readFileSync(file, "utf8");
    return findZIndexViolations(file, contents);
  });
  return [...tokenViolations, ...sourceViolations];
}

function main(): number {
  const reportOnly = process.argv.includes("--report");
  const files = collectZIndexSourceFiles();
  const violations = checkZIndexContract();
  console.log(`[z-index] scanned ${files.length} source files`);

  for (const violation of violations) {
    console.error(`${relative(WORKSPACE_ROOT, violation.file)}:${violation.line}: ${violation.message} (${violation.source})`);
  }

  if (violations.length > 0) {
    console.error(`[z-index] ${violations.length} violation(s)${reportOnly ? " (report only)" : ""}`);
    return reportOnly ? 0 : 1;
  }

  console.log("[z-index] contract OK");
  return 0;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
