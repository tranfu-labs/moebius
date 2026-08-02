import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTeamConversationPreferenceService,
} from "../src/team-conversation-preference.js";
import { AgentTeamPreferenceError } from "../src/team-conversation-preference-plan.js";
import {
  LAST_USED_AGENT_TEAM_FILE,
  readLastUsedAgentTeamStore,
  writeLastUsedAgentTeamStore,
} from "../src/team-conversation-preference-store.js";
import { listAgentTeams } from "../src/team-ipc.js";
import { serializeTeamDefinition, type TeamDefinition, type TeamOwnership } from "../src/team-model.js";
import { resolveTeamLocation } from "../src/team-store.js";

const usableDefinition: TeamDefinition = {
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager"],
};
const preferenceService = createTeamConversationPreferenceService({
  read: readLastUsedAgentTeamStore,
  write: writeLastUsedAgentTeamStore,
  list: listAgentTeams,
});
const { readLastUsedAgentTeam, recordSuccessfulConversationAgentTeam } = preferenceService;

describe("last-used conversation Agent team preference", () => {
  it("treats a missing or malformed record as no history", async () => {
    const dataRoot = await makeDataRoot();

    await expect(readLastUsedAgentTeam(dataRoot)).resolves.toBeNull();
    await fs.writeFile(path.join(dataRoot, LAST_USED_AGENT_TEAM_FILE), "not-json", "utf8");
    await expect(readLastUsedAgentTeam(dataRoot)).resolves.toBeNull();
  });

  it("records a usable team selected by a successfully created session", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeam(dataRoot, "development", "system", usableDefinition);
    await writeTeam(dataRoot, "my-team", "user", { ...usableDefinition, name: "我的团队" });

    await expect(recordSuccessfulConversationAgentTeam(dataRoot, {
      sessionId: "local:created-session",
      teamId: "my-team",
      ownership: "user",
    }, async () => true)).resolves.toEqual({ teamId: "my-team", ownership: "user" });

    await expect(readLastUsedAgentTeam(dataRoot)).resolves.toEqual({ teamId: "my-team", ownership: "user" });
    expect(JSON.parse(await fs.readFile(path.join(dataRoot, LAST_USED_AGENT_TEAM_FILE), "utf8"))).toEqual({
      version: 1,
      teamId: "my-team",
      ownership: "user",
    });
  });

  it("rejects drafts and needs-repair teams without changing the previous record", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeam(dataRoot, "development", "system", usableDefinition);
    await writeTeam(dataRoot, "draft", "user", {
      name: "未完成团队",
      description: "还没有主 Agent",
      primaryAgentSlug: null,
      memberOrder: [],
    });
    await writeTeam(dataRoot, "broken", "user", usableDefinition, false);

    await recordSuccessfulConversationAgentTeam(dataRoot, {
      sessionId: "local:first-session",
      teamId: "development",
      ownership: "system",
    }, async () => true);
    const before = await fs.readFile(path.join(dataRoot, LAST_USED_AGENT_TEAM_FILE), "utf8");

    for (const teamId of ["draft", "broken"]) {
      await expect(recordSuccessfulConversationAgentTeam(dataRoot, {
        sessionId: "local:failed-selection",
        teamId,
        ownership: "user",
      }, async () => true)).rejects.toBeInstanceOf(AgentTeamPreferenceError);
    }
    expect(await fs.readFile(path.join(dataRoot, LAST_USED_AGENT_TEAM_FILE), "utf8")).toBe(before);
  });

  it("requires a successful session identity before reaching the only write path", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeam(dataRoot, "development", "system", usableDefinition);

    await expect(recordSuccessfulConversationAgentTeam(dataRoot, {
      teamId: "development",
      ownership: "system",
    }, async () => false)).rejects.toBeInstanceOf(AgentTeamPreferenceError);
    await expect(readLastUsedAgentTeam(dataRoot)).resolves.toBeNull();
  });

  it("does not write when the supplied session was not actually created", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeam(dataRoot, "development", "system", usableDefinition);

    await expect(recordSuccessfulConversationAgentTeam(dataRoot, {
      sessionId: "local:missing-session",
      teamId: "development",
      ownership: "system",
    }, async () => false)).rejects.toBeInstanceOf(AgentTeamPreferenceError);

    await expect(readLastUsedAgentTeam(dataRoot)).resolves.toBeNull();
  });
});

async function makeDataRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-preference-"));
}

async function writeTeam(
  dataRoot: string,
  teamId: string,
  ownership: TeamOwnership,
  definition: TeamDefinition,
  includeAgent = true,
): Promise<void> {
  const location = resolveTeamLocation({ dataRoot, teamId, ownership });
  await fs.mkdir(location.directory, { recursive: true });
  await fs.writeFile(path.join(location.directory, "team.json"), serializeTeamDefinition(definition), "utf8");
  if (includeAgent && definition.primaryAgentSlug !== null) {
    const memberDirectory = path.join(location.directory, "members", definition.primaryAgentSlug);
    await fs.mkdir(memberDirectory, { recursive: true });
    await fs.writeFile(path.join(memberDirectory, "AGENT.md"), "# 开发经理\n\n默认接单\n", "utf8");
  }
}
