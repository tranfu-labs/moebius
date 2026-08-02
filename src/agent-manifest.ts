import { parseAgentMarkdownFrontmatter } from "./agent-frontmatter.js";

export interface AgentManifest {
  body: string;
}

export function parseAgentManifest(markdown: string): AgentManifest {
  return { body: parseAgentMarkdownFrontmatter(markdown).body };
}
