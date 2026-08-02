import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  AgentTeamPreferenceError,
  parseLastUsedAgentTeam,
  type LastUsedAgentTeamDocument,
} from "./team-conversation-preference-plan.js";
import type { LastUsedAgentTeam } from "./team-conversation-preference-contract.js";

export const LAST_USED_AGENT_TEAM_FILE = "last-used-team.json";

export async function readLastUsedAgentTeamStore(dataRoot: string): Promise<LastUsedAgentTeam | null> {
  try {
    return parseLastUsedAgentTeam(await fs.readFile(getPreferencePath(dataRoot), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError || error instanceof AgentTeamPreferenceError) {
      return null;
    }
    throw error;
  }
}

export async function writeLastUsedAgentTeamStore(
  dataRoot: string,
  document: LastUsedAgentTeamDocument,
): Promise<void> {
  const preferencePath = getPreferencePath(dataRoot);
  await fs.mkdir(path.dirname(preferencePath), { recursive: true });
  const temporaryPath = `${preferencePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, preferencePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function getPreferencePath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), LAST_USED_AGENT_TEAM_FILE);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
