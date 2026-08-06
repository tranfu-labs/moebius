import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiTeamBuilder } from "../src/ai-team-builder/index.js";
import { AiTeamWriteFileStore } from "../src/ai-team-builder/team-write-store.js";
import type { AiTeamBuilderProposal } from "../src/ai-team-builder/validator.js";
import {
  AiTeamWriter,
  type AiTeamWriterOptions,
} from "../src/ai-team-builder/team-writer.js";
import { createTestAgentTeamService } from "./helpers/agent-team-service.js";
import {
  forgetTrashedUserTeamRecord,
  registerUserTeamSnapshot,
} from "../src/team-record-store.js";
import {
  removeTeamExecutionBindings,
  replaceTeamExecutionBindings,
} from "../src/team-management-store.js";

const { listAgentTeams } = createTestAgentTeamService();

const temporaryRoots: string[] = [];

const proposal: AiTeamBuilderProposal = {
  team: { name: "Launch Team", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布并收尾",
      responsibilities: ["拆解工作", "复核证据"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "准备发布内容",
      responsibilities: ["提炼叙事", "准备渠道素材"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "分派内容工作。" },
    { speakerSlug: "content-planner", message: "提交内容。" },
    { speakerSlug: "launch-lead", message: "复核并收尾。" },
  ],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AiTeamWriter", () => {
  it("keeps an unconfirmed AI builder draft out of the outer team-list entry", async () => {
    const dataRoot = await makeDataRootWithBuiltInTeam();
    const builder = new AiTeamBuilder({
      dataRoot,
      codex: {
        execute: vi.fn(async () => ({
          ok: true as const,
          finalText: JSON.stringify({ phase: "proposal", ...proposal }),
          externalSessionId: "unconfirmed-draft-thread",
        })),
      },
      resolveExecutionProfile: async () => ({
        cli: "codex",
        model: "test-codex",
        effort: "high",
      }),
    });

    await expect(builder.submit("agent-teams", "持续负责产品发布")).resolves.toMatchObject({
      phase: "proposal",
      messages: expect.arrayContaining([
        { role: "user", text: "持续负责产品发布" },
      ]),
      proposal: { team: { name: proposal.team.name } },
    });
    await expect(listAgentTeams({ dataRoot, seedPending: false })).resolves.toMatchObject({
      status: "ready",
      teams: [{ id: "development", ownership: "system" }],
    });
  });

  it("makes a complete AI team visible through the outer team-list entry only after registration", async () => {
    const dataRoot = await makeDataRootWithBuiltInTeam();
    const lastUsedPath = path.join(dataRoot, ".state", "last-used-team.json");
    await fs.mkdir(path.dirname(lastUsedPath), { recursive: true });
    await fs.writeFile(lastUsedPath, '{"teamId":"development"}\n', "utf8");
    const writer = createWriter({ createId: () => "12345678-abcd" });

    const piProfile = {
      cli: "pi" as const,
      providerId: "deepseek" as const,
      providerProfileId: "deepseek-work",
      model: "deepseek-v4-pro",
      effort: "high",
    };
    const created = await writer.create(dataRoot, proposal, piProfile);

    expect(created.teamId).toBe("launch-team-12345678abcd");
    const listed = await listAgentTeams({ dataRoot, seedPending: false });
    expect(listed.status).toBe("ready");
    const createdListItem = listed.status === "ready"
      ? listed.teams.find((team) => team.id === created.teamId)
      : undefined;
    expect(createdListItem).toMatchObject({
      id: created.teamId,
      ownership: "user",
      status: "usable",
      canCreateConversation: true,
      definition: {
        primaryAgentSlug: "launch-lead",
        memberOrder: ["launch-lead", "content-planner"],
      },
      onboardingOrchestration: {
        status: "ready",
        relayBeats: proposal.relayBeats,
      },
      members: [
        { slug: "launch-lead", displayName: "发布负责人", executionProfile: { effectiveProfile: piProfile } },
        { slug: "content-planner", displayName: "内容策划", executionProfile: { effectiveProfile: piProfile } },
      ],
    });
    expect(created.snapshot.members.map((member) => member.agentMarkdown)).toEqual([
      expect.stringContaining("统筹发布并收尾"),
      expect.stringContaining("准备发布内容"),
    ]);
    expect(JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", created.teamId, "team.json"),
      "utf8",
    ))).not.toHaveProperty("relayBeats");
    expect(JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", created.teamId, "onboarding-orchestration.json"),
      "utf8",
    ))).toEqual({ version: 1, relayBeats: proposal.relayBeats });
    expect(await fs.readFile(lastUsedPath, "utf8")).toBe('{"teamId":"development"}\n');
    expect(await listDirectories(path.join(dataRoot, ".state", "ai-team-builder-staging"))).toEqual([]);
  });

  it("does not create a last-used team preference when AI creation starts without one", async () => {
    const dataRoot = await makeDataRootWithBuiltInTeam();
    const lastUsedPath = path.join(dataRoot, ".state", "last-used-team.json");

    await createWriter({ createId: () => "no-preference" }).create(dataRoot, proposal);

    await expect(fs.access(lastUsedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back the final directory and record when registration fails", async () => {
    const dataRoot = await makeDataRootWithBuiltInTeam();
    const rollbackRecord = vi.fn(async () => undefined);
    const writer = createWriter({
      createId: () => "abcdef",
      register: async () => {
        throw new Error("record write failed");
      },
      rollbackRecord,
    });

    await expect(writer.create(dataRoot, proposal)).rejects.toMatchObject({
      code: "AI_TEAM_WRITE_FAILED",
    });

    expect(rollbackRecord).toHaveBeenCalledWith({
      dataRoot,
      teamId: "launch-team-abcdef",
    });
    expect(await listDirectories(path.join(dataRoot, "teams"))).toEqual([".system"]);
    expect(await listDirectories(path.join(dataRoot, ".state", "ai-team-builder-staging"))).toEqual([]);
    await expect(listAgentTeams({ dataRoot, seedPending: false })).resolves.toMatchObject({
      status: "ready",
      teams: [{ id: "development", ownership: "system" }],
    });
  });

  it("rejects an invalid proposal before creating staging or formal directories", async () => {
    const dataRoot = await makeDataRootWithBuiltInTeam();
    const writer = createWriter();
    await expect(writer.create(dataRoot, {
      ...proposal,
      members: [proposal.members[0]!],
    })).rejects.toMatchObject({ code: "AI_TEAM_WRITE_FAILED" });
    await expect(fs.access(path.join(dataRoot, ".state", "ai-team-builder-staging"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await listDirectories(path.join(dataRoot, "teams"))).toEqual([".system"]);
  });
});

async function makeDataRootWithBuiltInTeam(): Promise<string> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-writer-"));
  temporaryRoots.push(dataRoot);
  const builtIn = path.join(dataRoot, "teams", ".system", "development");
  await fs.mkdir(path.join(builtIn, "members", "manager"), { recursive: true });
  await fs.writeFile(path.join(builtIn, "team.json"), `${JSON.stringify({
    name: "开发团队",
    description: "负责软件开发",
    primaryAgentSlug: "manager",
    memberOrder: ["manager"],
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(builtIn, "onboarding-orchestration.json"), `${JSON.stringify({
    version: 1,
    relayBeats: [{ speakerSlug: "manager", message: "拆解任务" }],
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(builtIn, "members", "manager", "AGENT.md"),
    "# 开发经理\n\n默认接单\n",
    "utf8",
  );
  return dataRoot;
}

function createWriter(options: Partial<AiTeamWriterOptions> = {}): AiTeamWriter {
  return new AiTeamWriter({
    store: new AiTeamWriteFileStore(),
    register: registerUserTeamSnapshot,
    rollbackRecord: forgetTrashedUserTeamRecord,
    replaceBindings: replaceTeamExecutionBindings,
    removeBindings: removeTeamExecutionBindings,
    createId: () => "generated",
    ...options,
  });
}

async function listDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
