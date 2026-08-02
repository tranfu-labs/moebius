import fs from "node:fs/promises";
import path from "node:path";

export const CEO_SCRIPTS_DIRNAME = "ceo-scripts";
export const REQUIRED_CEO_SCRIPT_IDS = [
  "default-plan-chain",
  "plan-review",
  "post-implementation-retro",
  "milestone-spawn-child-issues",
  "integration-acceptance",
  "integration-repair-child-issues",
  "roundtable-plan-review",
  "goal-intake",
] as const;

export type CeoScriptAction = "route" | "spawn_child_issues" | "roundtable" | "goal_intake";

export interface CeoScript {
  id: string;
  action: CeoScriptAction;
  title?: string;
  body: string;
  fileName: string;
}

export interface LoadCeoScriptsOptions {
  agentsDir: string;
  required?: boolean;
}

export async function loadCeoScripts(options: LoadCeoScriptsOptions): Promise<CeoScript[]> {
  const dir = path.join(options.agentsDir, CEO_SCRIPTS_DIRNAME);
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (options.required === false && isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new Error(`ceo-scripts-load-failed:${formatError(error)}`);
  }

  const scripts: CeoScript[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const raw = await fs.readFile(path.join(dir, entry.name), "utf8");
    scripts.push(parseCeoScriptMarkdown(raw, entry.name));
  }

  validateCeoScripts(scripts, options.required !== false);
  return scripts.sort((left, right) => left.id.localeCompare(right.id));
}

export function parseCeoScriptMarkdown(markdown: string, fileName = "script.md"): CeoScript {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match === null) {
    throw new Error(`Invalid CEO script ${fileName}: missing frontmatter`);
  }

  const frontmatter = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const fields = parseSimpleFrontmatter(frontmatter);
  const id = fields.get("id") ?? "";
  const action = fields.get("action") ?? "";
  const title = fields.get("title");

  if (!isValidWorkflowId(id)) {
    throw new Error(`Invalid CEO script ${fileName}: invalid id`);
  }
  if (!isCeoScriptAction(action)) {
    throw new Error(`Invalid CEO script ${fileName}: invalid action`);
  }
  if (body === "") {
    throw new Error(`Invalid CEO script ${fileName}: empty body`);
  }

  return {
    id,
    action,
    title: title?.trim() === "" ? undefined : title,
    body,
    fileName,
  };
}

export function validateCeoScripts(scripts: CeoScript[], requireRequiredScripts = true): void {
  const ids = new Map<string, string>();
  for (const script of scripts) {
    if (ids.has(script.id)) {
      throw new Error(`Invalid CEO scripts: duplicate workflow id ${script.id}`);
    }
    ids.set(script.id, script.fileName);
  }

  if (requireRequiredScripts) {
    const missing = REQUIRED_CEO_SCRIPT_IDS.filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw new Error(`Invalid CEO scripts: missing workflow ${missing.join(",")}`);
    }
  }
}

export function getCeoScriptById(scripts: readonly CeoScript[], id: string): CeoScript | null {
  return scripts.find((script) => script.id === id) ?? null;
}

export function formatCeoScriptsForPrompt(scripts: readonly CeoScript[]): string {
  if (scripts.length === 0) {
    return "可用 CEO 剧本：未加载。";
  }

  return [
    "可用 CEO 剧本（数据文件，新增 workflow 通过新增剧本完成）：",
    ...scripts.map(
      (script) => `\n## ${script.id}\n- action: ${script.action}\n- file: ${script.fileName}\n\n${script.body}`,
    ),
  ].join("\n");
}

function parseSimpleFrontmatter(frontmatter: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match === null) {
      continue;
    }
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) {
      continue;
    }
    result.set(key, rawValue.trim().replace(/^['"]|['"]$/g, ""));
  }
  return result;
}

function isValidWorkflowId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/u.test(value);
}

function isCeoScriptAction(value: string): value is CeoScriptAction {
  return value === "route" || value === "spawn_child_issues" || value === "roundtable" || value === "goal_intake";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
