import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeTeamDefinition, type TeamDefinition } from "../src/team-model.js";
import {
  addTeamMember,
  createUserTeam,
  determineTeamOwnership,
  duplicateBuiltInTeamDirectory,
  duplicateTeamMemberDirectory,
  duplicateUserTeamDirectory,
  getSystemTeamsRoot,
  getTeamsRoot,
  listTeamLocations,
  readTeamSnapshot,
  resolveTeamLocation,
  setTeamPrimaryAgent,
  trashTeamMemberDirectory,
  trashUserTeamDirectory,
  updateTeamInformation,
  writeMemberAgentMarkdown,
  writeTeamDefinition,
} from "../src/team-store.js";

const temporaryRoots: string[] = [];
const usableDefinition: TeamDefinition = {
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager", "developer"],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("team disk store", () => {
  it("separates .system built-in teams from direct user-team siblings", async () => {
    const dataRoot = await makeDataRoot();
    const builtIn = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const user = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });

    expect(getTeamsRoot(dataRoot)).toBe(path.join(dataRoot, "teams"));
    expect(getSystemTeamsRoot(dataRoot)).toBe(path.join(dataRoot, "teams", ".system"));
    expect(builtIn.directory).toBe(path.join(dataRoot, "teams", ".system", "development"));
    expect(user.directory).toBe(path.join(dataRoot, "teams", "my-development"));
    expect(determineTeamOwnership(dataRoot, path.join(builtIn.directory, "members", "manager", "AGENT.md"))).toBe(
      "system",
    );
    expect(determineTeamOwnership(dataRoot, path.join(user.directory, "team.json"))).toBe("user");
  });

  it("lists built-in teams first and user teams without treating .system as a team", async () => {
    const dataRoot = await makeDataRoot();
    await Promise.all([
      fs.mkdir(path.join(dataRoot, "teams", ".system", "development"), { recursive: true }),
      fs.mkdir(path.join(dataRoot, "teams", "z-team"), { recursive: true }),
      fs.mkdir(path.join(dataRoot, "teams", "a-team"), { recursive: true }),
    ]);

    const locations = await listTeamLocations(dataRoot);

    expect(locations.map(({ id, ownership }) => ({ id, ownership }))).toEqual([
      { id: "development", ownership: "system" },
      { id: "a-team", ownership: "user" },
      { id: "z-team", ownership: "user" },
    ]);
  });

  it("reads team identity from team.json and member identity only from each AGENT.md", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单并组织团队推进\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现并验证代码\n");

    const snapshot = await readTeamSnapshot(location);

    expect(snapshot.status).toBe("usable");
    expect(snapshot.canCreateConversation).toBe(true);
    expect(snapshot.definition).toEqual(usableDefinition);
    expect(snapshot.members.map(({ slug, displayName, description }) => ({ slug, displayName, description }))).toEqual([
      { slug: "manager", displayName: "开发经理", description: "默认接单并组织团队推进" },
      { slug: "developer", displayName: "开发", description: "负责实现并验证代码" },
    ]);
    expect(JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8"))).toEqual(usableDefinition);
  });

  it("marks partial canonical member identity as needing repair", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "invalid-metadata", ownership: "user" });
    await writeTeamDefinition(location, {
      ...usableDefinition,
      memberOrder: ["manager"],
    });
    await writeMemberAgentMarkdown(location, "manager", `---
display_name: 开发经理
---

# 角色

默认接单
`);

    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "needs-repair",
      canCreateConversation: false,
      members: [],
      issues: [{ code: "member-agent-metadata-invalid", slug: "manager" }],
    });
  });

  it("allows direct data-layer writes to official team content without changing its ownership", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const manifestPath = path.join(location.directory, "team.json");
    const agentPath = path.join(location.directory, "members", "manager", "AGENT.md");
    await fs.mkdir(path.dirname(agentPath), { recursive: true });
    await fs.writeFile(manifestPath, serializeTeamDefinition(usableDefinition), "utf8");
    await fs.writeFile(agentPath, "# 原始经理\n\n原始描述\n", "utf8");

    await writeTeamDefinition(location, { ...usableDefinition, name: "已修改" });
    await writeMemberAgentMarkdown(location, "manager", "# 已修改\n");
    expect(JSON.parse(await fs.readFile(manifestPath, "utf8"))).toMatchObject({ name: "已修改" });
    expect(await fs.readFile(agentPath, "utf8")).toBe("# 已修改\n");
    expect(determineTeamOwnership(dataRoot, agentPath)).toBe("system");
  });

  it("switches the primary Agent only to a current member with a readable AGENT.md", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现\n");

    await expect(setTeamPrimaryAgent(location, "developer")).resolves.toMatchObject({
      definition: { primaryAgentSlug: "developer", memberOrder: ["manager", "developer"] },
      status: "usable",
    });
    await expect(setTeamPrimaryAgent(location, "reviewer")).rejects.toMatchObject({
      code: "TEAM_PRIMARY_AGENT_INVALID",
    });

    await fs.rm(path.join(location.directory, "members", "manager", "AGENT.md"));
    await expect(setTeamPrimaryAgent(location, "manager")).rejects.toMatchObject({
      code: "TEAM_PRIMARY_AGENT_INVALID",
    });
    expect(JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8"))).toMatchObject({
      primaryAgentSlug: "developer",
    });
  });

  it("keeps externally modified files under .system owned and editable", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const agentPath = path.join(location.directory, "members", "manager", "AGENT.md");
    await fs.mkdir(path.dirname(agentPath), { recursive: true });
    await fs.writeFile(path.join(location.directory, "team.json"), serializeTeamDefinition(usableDefinition), "utf8");
    await fs.writeFile(agentPath, "# 外部修改的经理\n\n仍然是内置内容\n", "utf8");

    const [listed] = await listTeamLocations(dataRoot);
    expect(listed?.ownership).toBe("system");
    expect(determineTeamOwnership(dataRoot, agentPath)).toBe("system");
    await writeMemberAgentMarkdown(location, "manager", "# UI 写入\n");
    expect(await fs.readFile(agentPath, "utf8")).toBe("# UI 写入\n");
  });

  it("copies a usable built-in team into an editable user team that can add Agents", async () => {
    const dataRoot = await makeDataRoot();
    const source = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await fs.mkdir(path.join(source.directory, "members", "manager", "references"), { recursive: true });
    await fs.mkdir(path.join(source.directory, "playbooks"), { recursive: true });
    await fs.writeFile(path.join(source.directory, "team.json"), serializeTeamDefinition(usableDefinition), "utf8");
    await fs.writeFile(path.join(source.directory, "members", "manager", "AGENT.md"), "# 开发经理\n\n默认接单\n", "utf8");
    await fs.mkdir(path.join(source.directory, "members", "developer"), { recursive: true });
    await fs.writeFile(path.join(source.directory, "members", "developer", "AGENT.md"), "# 开发\n\n负责实现\n", "utf8");
    await fs.writeFile(path.join(source.directory, "members", "manager", "references", "rules.md"), "规则\n", "utf8");
    await fs.writeFile(path.join(source.directory, "playbooks", "checklist.txt"), "check\n", "utf8");
    await fs.writeFile(path.join(source.directory, ".team-note"), "hidden\n", "utf8");
    const lastUsedSentinel = path.join(dataRoot, "last-used-team.json");
    await fs.writeFile(lastUsedSentinel, JSON.stringify({ teamId: "another-team" }), "utf8");

    const destination = await duplicateBuiltInTeamDirectory(source);

    expect(destination).toMatchObject({ id: "development-copy", ownership: "user" });
    expect(destination.directory).toBe(path.join(dataRoot, "teams", "development-copy"));
    expect(await readFileTree(destination.directory)).toEqual(await readFileTree(source.directory));
    expect(await fs.readFile(lastUsedSentinel, "utf8")).toBe(JSON.stringify({ teamId: "another-team" }));

    await fs.writeFile(path.join(destination.directory, "playbooks", "checklist.txt"), "copied team edit\n", "utf8");
    expect(await fs.readFile(path.join(source.directory, "playbooks", "checklist.txt"), "utf8")).toBe("check\n");
    await expect(writeMemberAgentMarkdown(destination, "manager", "# 可编辑副本\n")).resolves.toBeUndefined();

    await expect(readTeamSnapshot(destination)).resolves.toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: { primaryAgentSlug: "manager", memberOrder: ["manager", "developer"] },
    });
    await expect(addTeamMember(destination)).resolves.toMatchObject({
      member: { slug: "agent" },
      team: {
        status: "usable",
        canCreateConversation: true,
        definition: { primaryAgentSlug: "manager", memberOrder: ["manager", "developer", "agent"] },
      },
    });
  });

  it("copies a whole user team through the shared directory-copy path", async () => {
    const dataRoot = await makeDataRoot();
    const source = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(source, usableDefinition);
    await writeMemberAgentMarkdown(source, "manager", "# 开发经理\n\n默认接单\n");
    await writeMemberAgentMarkdown(source, "developer", "# 开发\n\n负责实现\n");
    await fs.writeFile(path.join(source.directory, "team-notes.md"), "完整复制\n", "utf8");

    const destination = await duplicateUserTeamDirectory(source);

    expect(destination).toMatchObject({ id: "my-development-copy", ownership: "user" });
    expect(await readFileTree(destination.directory)).toEqual(await readFileTree(source.directory));
    expect(await readTeamSnapshot(destination)).toMatchObject({ status: "usable", canCreateConversation: true });
  });

  it("copies an Agent directory with related files and assigns a new stable slug in the same team", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现并交给 @manager\n");
    await fs.mkdir(path.join(location.directory, "members", "developer", "references"), { recursive: true });
    await fs.writeFile(
      path.join(location.directory, "members", "developer", "references", "rules.md"),
      "成员相关文件\n",
      "utf8",
    );

    const copied = await duplicateTeamMemberDirectory(location, "developer");

    expect(copied.member).toMatchObject({
      slug: "developer-2",
      displayName: "开发",
      agentMarkdown: "# 开发\n\n负责实现并交给 @manager\n",
    });
    expect(copied.team.definition).toMatchObject({
      primaryAgentSlug: "manager",
      memberOrder: ["manager", "developer", "developer-2"],
    });
    expect(await fs.readFile(
      path.join(location.directory, "members", "developer-2", "references", "rules.md"),
      "utf8",
    )).toBe("成员相关文件\n");
  });

  it("moves a non-primary Agent to recoverable trash and keeps a still-valid team usable", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n下一步交给 @developer\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现\n");
    await fs.writeFile(path.join(location.directory, "members", "developer", "notes.txt"), "可恢复\n", "utf8");
    const trashRoot = path.join(dataRoot, "system-trash");
    const trashedMember = path.join(trashRoot, "developer");

    const team = await trashTeamMemberDirectory(location, "developer", async (targetPath) => {
      await fs.mkdir(trashRoot, { recursive: true });
      await fs.rename(targetPath, trashedMember);
    });

    expect(team).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        primaryAgentSlug: "manager",
        memberOrder: ["manager"],
      },
      issues: [],
    });
    expect(await fs.readFile(path.join(trashedMember, "notes.txt"), "utf8")).toBe("可恢复\n");
    expect(await fs.readFile(path.join(location.directory, "members", "manager", "AGENT.md"), "utf8"))
      .toContain("@developer");
  });

  it("requires another valid primary Agent before deleting the current primary", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现\n");
    let trashCalled = false;

    await expect(trashTeamMemberDirectory(location, "manager", async () => {
      trashCalled = true;
    })).rejects.toMatchObject({ code: "TEAM_PRIMARY_AGENT_INVALID" });
    expect(trashCalled).toBe(false);
    expect((await readTeamSnapshot(location)).definition).toEqual(usableDefinition);
  });

  it("allows an unavailable former primary Agent to be moved to trash after selecting a valid primary", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "repairable-primary", ownership: "user" });
    await writeTeamDefinition(location, usableDefinition);
    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单\n");
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现\n");
    await fs.rm(path.join(location.directory, "members", "manager", "AGENT.md"));

    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "needs-repair",
      issues: [{ code: "member-agent-missing", slug: "manager" }],
    });
    await setTeamPrimaryAgent(location, "developer");

    const trashedMember = path.join(dataRoot, "system-trash", "manager");
    const repaired = await trashTeamMemberDirectory(location, "manager", async (targetPath) => {
      await fs.mkdir(path.dirname(trashedMember), { recursive: true });
      await fs.rename(targetPath, trashedMember);
    });

    expect(repaired).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        primaryAgentSlug: "developer",
        memberOrder: ["developer"],
      },
      issues: [],
    });
    await expect(fs.stat(trashedMember)).resolves.toMatchObject({});
  });

  it("moves a user team directory to recoverable trash and rejects built-in teams", async () => {
    const dataRoot = await makeDataRoot();
    const user = resolveTeamLocation({ dataRoot, teamId: "my-development", ownership: "user" });
    const builtIn = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await writeTeamDefinition(user, {
      ...usableDefinition,
      primaryAgentSlug: null,
      memberOrder: [],
    });
    await fs.mkdir(builtIn.directory, { recursive: true });
    const trashRoot = path.join(dataRoot, "system-trash");
    const trashedTeam = path.join(trashRoot, user.id);

    await trashUserTeamDirectory(user, async (targetPath) => {
      await fs.mkdir(trashRoot, { recursive: true });
      await fs.rename(targetPath, trashedTeam);
    });

    expect(JSON.parse(await fs.readFile(path.join(trashedTeam, "team.json"), "utf8"))).toMatchObject({
      name: "开发团队",
      primaryAgentSlug: null,
      memberOrder: [],
    });
    await expect(fs.access(user.directory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(trashUserTeamDirectory(builtIn, async () => undefined)).rejects.toMatchObject({
      code: "BUILT_IN_TEAM_READ_ONLY",
    });
  });

  it("marks a new team with no primary agent as an unfinished draft, not a repair", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "draft", ownership: "user" });
    await writeTeamDefinition(location, {
      name: "新的开发团队",
      description: "还没有可接收任务的 Agent",
      primaryAgentSlug: null,
      memberOrder: [],
    });

    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "unfinished-draft",
      canCreateConversation: false,
      issues: [],
    });
  });

  it("retains a newly created team as an unfinished draft until its first Agent is successfully added", async () => {
    const dataRoot = await makeDataRoot();
    const draft = await createUserTeam(dataRoot, {
      name: "  新的开发团队  ",
      description: "  负责新产品开发  ",
    });

    expect(draft).toMatchObject({
      definition: {
        name: "新的开发团队",
        description: "负责新产品开发",
        primaryAgentSlug: null,
        memberOrder: [],
      },
      status: "unfinished-draft",
      canCreateConversation: false,
      issues: [],
    });
    await expect(readTeamSnapshot(draft.location)).resolves.toMatchObject({
      status: "unfinished-draft",
      canCreateConversation: false,
    });

    const first = await addTeamMember(draft.location);
    expect(first.member).toMatchObject({
      slug: "agent",
      displayName: "新 Agent",
      description: "描述这个 Agent 负责什么。",
    });
    expect(first.team).toMatchObject({
      definition: { primaryAgentSlug: "agent", memberOrder: ["agent"] },
      status: "usable",
      canCreateConversation: true,
    });
  });

  it("keeps member slugs stable when display names change and gives later members unique slugs", async () => {
    const dataRoot = await makeDataRoot();
    const draft = await createUserTeam(dataRoot, { name: "写作团队", description: "负责内容" });
    const first = await addTeamMember(draft.location);
    await writeMemberAgentMarkdown(draft.location, first.member.slug, "# 主编\n\n负责内容方向\n");

    const renamed = await readTeamSnapshot(draft.location);
    expect(renamed.definition).toMatchObject({ primaryAgentSlug: "agent", memberOrder: ["agent"] });
    expect(renamed.members[0]).toMatchObject({ slug: "agent", displayName: "主编" });

    const second = await addTeamMember(draft.location);
    expect(second.member.slug).toBe("agent-2");
    expect(second.team.definition).toMatchObject({
      primaryAgentSlug: "agent",
      memberOrder: ["agent", "agent-2"],
    });
  });

  it("updates only team name and description without changing members or the primary Agent", async () => {
    const dataRoot = await makeDataRoot();
    const draft = await createUserTeam(dataRoot, { name: "旧名称", description: "旧描述" });
    const first = await addTeamMember(draft.location);

    const updated = await updateTeamInformation(draft.location, { name: "新名称", description: "新描述" });

    expect(updated.definition).toEqual({
      name: "新名称",
      description: "新描述",
      primaryAgentSlug: first.member.slug,
      memberOrder: [first.member.slug],
    });
    expect(updated.members.map((member) => member.slug)).toEqual([first.member.slug]);
  });

  it("marks missing AGENT.md as needing repair and clears the state after restoration", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "repairable", ownership: "user" });
    await writeTeamDefinition(location, {
      ...usableDefinition,
      memberOrder: ["manager"],
    });

    const broken = await readTeamSnapshot(location);
    expect(broken.status).toBe("needs-repair");
    expect(broken.issues).toMatchObject([{ code: "member-agent-missing", slug: "manager" }]);

    await writeMemberAgentMarkdown(location, "manager", "# 开发经理\n\n默认接单\n");
    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "usable",
      canCreateConversation: true,
      issues: [],
    });
  });

  it("marks an unreadable AGENT.md entry as needing repair", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "unreadable-agent", ownership: "user" });
    await writeTeamDefinition(location, {
      ...usableDefinition,
      memberOrder: ["manager"],
    });
    await fs.mkdir(path.join(location.directory, "members", "manager", "AGENT.md"), { recursive: true });

    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "needs-repair",
      canCreateConversation: false,
      issues: [{ code: "member-agent-unreadable", slug: "manager" }],
    });
  });

  it("marks duplicate and missing slugs from externally edited team.json as needing repair", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "broken-slugs", ownership: "user" });
    await fs.mkdir(location.directory, { recursive: true });
    await fs.writeFile(
      path.join(location.directory, "team.json"),
      JSON.stringify({
        ...usableDefinition,
        primaryAgentSlug: null,
        memberOrder: ["developer", "", "developer"],
        relayBeats: [{ speakerSlug: "developer", message: "实现任务" }],
      }),
      "utf8",
    );
    await writeMemberAgentMarkdown(location, "developer", "# 开发\n\n负责实现\n");

    const snapshot = await readTeamSnapshot(location);

    expect(snapshot.status).toBe("needs-repair");
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(["member-slug-missing", "member-slug-duplicate"]);
  });

  it("represents a missing team directory as needing repair", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "moved-team", ownership: "user" });

    await expect(readTeamSnapshot(location)).resolves.toMatchObject({
      status: "needs-repair",
      canCreateConversation: false,
      issues: [{ code: "team-directory-missing" }],
    });
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-store-"));
  temporaryRoots.push(root);
  return root;
}

async function readFileTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        result[path.relative(root, absolutePath)] = await fs.readFile(absolutePath, "utf8");
      }
    }
  };
  await visit(root);
  return result;
}
