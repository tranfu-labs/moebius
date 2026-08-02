import type { LocalConsoleExecutionProfile } from "./types.js";

export interface LocalConsoleAgentFile {
  name: string;
  path?: string;
  agentMarkdown?: string;
  executionProfile?: LocalConsoleExecutionProfile | null;
}
