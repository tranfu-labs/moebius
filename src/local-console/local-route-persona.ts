import fs from "node:fs/promises";
import path from "node:path";

import { parseAgentManifest } from "../agent-manifest.js";
import { formatCeoScriptsForPrompt, loadCeoScripts } from "../ceo-scripts.js";

export async function loadLocalRoutePersona(agentsDir: string): Promise<string> {
  const raw = await fs.readFile(path.join(agentsDir, "ceo.md"), "utf8");
  const persona = parseAgentManifest(raw).body;
  const scripts = await loadCeoScripts({ agentsDir, required: false });
  return `${persona.trimEnd()}

## CEO 剧本库

${formatCeoScriptsForPrompt(scripts)}`;
}
