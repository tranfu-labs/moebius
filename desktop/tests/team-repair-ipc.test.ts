import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeTeamDefinition, type TeamDefinition } from "../src/team-model.js";
import { createTestAgentTeamService } from "./helpers/agent-team-service.js";
import { relocateAgentTeamRecord, removeAgentTeamRecord } from "../src/team-repair-ipc.js";
import { resolveTeamLocation } from "../src/team-store.js";

const { listAgentTeams } = createTestAgentTeamService();

const temporaryRoots: string[] = [];
const definition: TeamDefinition = {
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager"],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent team repair IPC service", () => {
  it("keeps the original record and gives a concrete reason when relocation is rejected", async () => {
    const dataRoot = await makeDataRoot();
    await createBuiltIn(dataRoot);
    const user = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    await createTeam(user.directory, definition, "# 开发经理\n\n默认接单\n");
    await listAgentTeams({ dataRoot, seedPending: false });
    await fs.rename(user.directory, path.join(dataRoot, "teams", "moved-team"));
    const invalid = path.join(dataRoot, "teams", "not-a-team");
    await fs.mkdir(invalid);

    await expect(relocateAgentTeamRecord(dataRoot, {
      teamId: "my-team",
      ownership: "user",
      directory: invalid,
    })).rejects.toMatchObject({
      code: "TEAM_RELOCATION_REJECTED",
      message: "所选位置缺少可读取的团队信息文件。",
    });
    const response = await listAgentTeams({ dataRoot, seedPending: false });
    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.teams.find((team) => team.id === "my-team")).toMatchObject({
        id: "my-team",
        status: "needs-repair",
      });
    }
  });

  it("rejects removing usable records and never accepts repair mutations for built-in teams", async () => {
    const dataRoot = await makeDataRoot();
    await createBuiltIn(dataRoot);
    const user = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    await createTeam(user.directory, definition, "# 开发经理\n\n默认接单\n");
    await listAgentTeams({ dataRoot, seedPending: false });

    await expect(removeAgentTeamRecord(dataRoot, {
      teamId: "my-team",
      ownership: "user",
    })).rejects.toMatchObject({ code: "TEAM_RECORD_INVALID" });
    await expect(removeAgentTeamRecord(dataRoot, {
      teamId: "development",
      ownership: "system",
    })).rejects.toMatchObject({ code: "AGENT_TEAM_REPAIR_REQUEST_INVALID" });
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-repair-ipc-"));
  temporaryRoots.push(root);
  return root;
}

async function createBuiltIn(dataRoot: string): Promise<void> {
  const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
  await createTeam(location.directory, definition, "# 开发经理\n\n默认接单\n");
}

async function createTeam(directory: string, teamDefinition: TeamDefinition, markdown: string): Promise<void> {
  await fs.mkdir(path.join(directory, "members", "manager"), { recursive: true });
  await fs.writeFile(path.join(directory, "team.json"), serializeTeamDefinition(teamDefinition), "utf8");
  await fs.writeFile(path.join(directory, "members", "manager", "AGENT.md"), markdown, "utf8");
}
