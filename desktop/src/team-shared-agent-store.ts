import fs from "node:fs/promises";
import path from "node:path";

import type { LocalConsoleAgentFile } from "../../src/local-console/runtime.js";

export async function listSharedAgentFiles(dataRoot: string): Promise<LocalConsoleAgentFile[]> {
  const directory = path.join(dataRoot, "agents");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({ name: path.basename(entry.name, ".md"), path: path.join(directory, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
