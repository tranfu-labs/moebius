import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSystemTeamsRoot,
  getTeamsRoot,
  listTeamLocations,
  readTeamSnapshot,
  resolveTeamLocation,
} from "../src/team-store.js";
import {
  TEAMS_SEED_MARKER_FILE,
  computeTeamSeedFingerprint,
  readTeamSeedConflicts,
  seedBuiltInTeams,
} from "../src/team-seed.js";
import { readTeamOnboardingOrchestration } from "../src/team-onboarding-orchestration-store.js";
import {
  getPackagedTeamCacheDirectory,
  readTeamExecutionBindings,
} from "../src/team-management-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const packagedSeedRoot = path.join(repositoryRoot, "seeds", "teams");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("built-in team seed", () => {
  it("packages a valid development team with three concise member identities", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot })).resolves.toMatchObject({
      status: "seeded",
    });

    const snapshot = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" }),
    );
    expect(snapshot).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "开发团队",
        description: "负责软件方案、实现、测试、复核和主理收尾",
        primaryAgentSlug: "dev-manager",
        memberOrder: ["dev-manager", "dev", "qa"],
      },
    });
    await expect(readTeamOnboardingOrchestration({
      directory: snapshot.location.directory,
      memberOrder: snapshot.definition?.memberOrder ?? [],
    })).resolves.toMatchObject({
      status: "ready",
      source: "independent",
      orchestration: {
        version: 1,
        relayBeats: [
          { speakerSlug: "dev-manager" },
          { speakerSlug: "dev" },
          { speakerSlug: "qa" },
          { speakerSlug: "dev" },
          { speakerSlug: "qa" },
          { speakerSlug: "dev-manager" },
        ],
      },
    });
    expect(snapshot.members.map(({ slug, displayName, description }) => ({ slug, displayName, description }))).toEqual([
      { slug: "dev-manager", displayName: "开发经理", description: "负责技术决策、团队调度与会话收尾。" },
      { slug: "dev", displayName: "开发", description: "负责方案落地、代码实现与验证。" },
      { slug: "qa", displayName: "软件测试", description: "负责测试执行、风险复核与质量意见。" },
    ]);

    const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "desktop", "package.json"), "utf8")) as {
      build: { extraResources: Array<{ from: string; to: string }> };
    };
    expect(packageJson.build.extraResources).toContainEqual({ from: "../seeds/teams", to: "seed/teams" });
  });

  it("packages the general assistant as one lightweight primary Agent with its own recommendation", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });

    const snapshot = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "general-assistant", ownership: "system" }),
    );
    expect(snapshot).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "通用助手",
        primaryAgentSlug: "assistant",
        memberOrder: ["assistant"],
      },
      members: [{
        slug: "assistant",
        displayName: "通用助手",
        description: "处理一般对话与任务",
      }],
    });
    expect(snapshot.members[0]?.agentMarkdown).toContain([
      "---",
      "display_name: 通用助手",
      "description: 处理一般对话与任务",
      "---",
    ].join("\n"));
    expect(snapshot.members[0]?.agentMarkdown).toContain("## 输入契约");
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "general-assistant",
    })).toEqual({ assistant: { source: "recommended" } });
  });

  it("adds the general assistant to an existing installation without rewriting existing teams", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const oldSeed = path.join(root, "old-seed");
    await fs.cp(packagedSeedRoot, oldSeed, { recursive: true });
    await fs.rm(path.join(oldSeed, "general-assistant"), { recursive: true, force: true });
    await seedBuiltInTeams({ seedTeamsRoot: oldSeed, dataRoot });
    const developerAgent = path.join(
      getSystemTeamsRoot(dataRoot),
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.writeFile(developerAgent, "# local customization\n", "utf8");

    expect(await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot }))
      .toMatchObject({ status: "seeded" });
    expect(await fs.readFile(developerAgent, "utf8")).toBe("# local customization\n");
    const general = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "general-assistant", ownership: "system" }),
    );
    expect(general).toMatchObject({ status: "usable", canCreateConversation: true });
  });

  it("reports a stable identity conflict and preserves the user team when adding the official team", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const userTeam = path.join(getTeamsRoot(dataRoot), "general-assistant");
    await writeValidTeamDirectory(userTeam, "用户自己的通用助手");
    const before = await snapshotFiles(userTeam);

    const conflicted = await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });

    expect(conflicted).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "stable-identity", canPreserve: true }],
    });
    expect(await readTeamSeedConflicts(dataRoot)).toEqual(conflicted.conflicts);
    expect(await snapshotFiles(userTeam)).toEqual(before);

    const recovered = await seedBuiltInTeams({
      seedTeamsRoot: packagedSeedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    });

    expect(recovered.conflicts).toEqual([]);
    expect(await snapshotFiles(userTeam)).toEqual(before);
    const locations = await listTeamLocations(dataRoot);
    expect(locations.filter((location) => location.id === "general-assistant"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ ownership: "user" }),
        expect.objectContaining({ ownership: "system" }),
      ]));
  });

  it("blocks preservation while the conflicting user team is unreadable and allows retry after repair", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const userTeam = path.join(getTeamsRoot(dataRoot), "general-assistant");
    await fs.mkdir(userTeam, { recursive: true });
    await fs.writeFile(path.join(userTeam, "keep.txt"), "repair me\n", "utf8");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot })).resolves.toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "stable-identity", canPreserve: false }],
    });
    await expect(seedBuiltInTeams({
      seedTeamsRoot: packagedSeedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    })).resolves.toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "stable-identity", canPreserve: false }],
    });
    expect((await listTeamLocations(dataRoot)).filter(
      (location) => location.ownership === "system" && location.id === "general-assistant",
    )).toEqual([]);

    await writeValidTeamDirectory(userTeam, "修复后的用户团队");
    expect(await readTeamSeedConflicts(dataRoot)).toEqual([
      { teamId: "general-assistant", kind: "stable-identity", canPreserve: true },
    ]);
    await expect(seedBuiltInTeams({
      seedTeamsRoot: packagedSeedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    })).resolves.toMatchObject({ status: "seeded", conflicts: [] });
  });

  it("preserves an occupied official directory and registers General Assistant at a managed alternate location", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const occupied = path.join(getSystemTeamsRoot(dataRoot), "general-assistant");
    await fs.mkdir(occupied, { recursive: true });
    await fs.writeFile(path.join(occupied, "keep.txt"), "do not replace\n", "utf8");

    const conflicted = await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });
    expect(conflicted).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "directory", canPreserve: true }],
    });
    expect(await fs.readFile(path.join(occupied, "keep.txt"), "utf8")).toBe("do not replace\n");
    expect((await listTeamLocations(dataRoot)).some(
      (location) => location.ownership === "system" && location.id === "general-assistant",
    )).toBe(false);

    await seedBuiltInTeams({
      seedTeamsRoot: packagedSeedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    });

    expect(await fs.readFile(path.join(occupied, "keep.txt"), "utf8")).toBe("do not replace\n");
    const official = resolveTeamLocation({
      dataRoot,
      teamId: "general-assistant",
      ownership: "system",
    });
    expect(path.basename(official.directory)).toBe("general-assistant.official");
    await expect(readTeamSnapshot(official)).resolves.toMatchObject({
      status: "usable",
      canCreateConversation: true,
    });
  });

  it("keeps a directory conflict recoverable after a failed preserve attempt", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const seedRoot = path.join(root, "seed");
    await fs.cp(packagedSeedRoot, seedRoot, { recursive: true });
    const occupied = path.join(getSystemTeamsRoot(dataRoot), "general-assistant");
    await fs.mkdir(occupied, { recursive: true });
    await fs.writeFile(path.join(occupied, "keep.txt"), "unchanged\n", "utf8");
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await fs.rm(path.join(seedRoot, "general-assistant", "official.json"));

    await expect(seedBuiltInTeams({
      seedTeamsRoot: seedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    })).rejects.toThrow();

    expect(await fs.readFile(path.join(occupied, "keep.txt"), "utf8")).toBe("unchanged\n");
    expect(await readTeamSeedConflicts(dataRoot)).toEqual([
      { teamId: "general-assistant", kind: "directory", canPreserve: true },
    ]);
    await fs.copyFile(
      path.join(packagedSeedRoot, "general-assistant", "official.json"),
      path.join(seedRoot, "general-assistant", "official.json"),
    );
    await expect(seedBuiltInTeams({
      seedTeamsRoot: seedRoot,
      dataRoot,
      preserveGeneralAssistantConflicts: true,
    })).resolves.toMatchObject({ status: "seeded", conflicts: [] });
  });

  it("packages a valid content production team with five specialized members", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot })).resolves.toMatchObject({
      status: "seeded",
    });

    const snapshot = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "content-production", ownership: "system" }),
    );
    expect(snapshot).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "内容生产团队",
        description: "负责选题调研、内容创作、视觉制作、发布包装和总控交付",
        primaryAgentSlug: "content-production-orchestrator",
        memberOrder: [
          "content-production-orchestrator",
          "evidence-research",
          "editorial-production",
          "visual-production",
          "publishing-delivery",
        ],
      },
    });
    await expect(readTeamOnboardingOrchestration({
      directory: snapshot.location.directory,
      memberOrder: snapshot.definition?.memberOrder ?? [],
    })).resolves.toMatchObject({
      status: "ready",
      source: "independent",
      orchestration: {
        version: 1,
        relayBeats: [
          { speakerSlug: "content-production-orchestrator" },
          { speakerSlug: "evidence-research" },
          { speakerSlug: "editorial-production" },
          { speakerSlug: "visual-production" },
          { speakerSlug: "publishing-delivery" },
          { speakerSlug: "content-production-orchestrator" },
        ],
      },
    });
    expect(snapshot.members.map(({ slug, displayName, description }) => ({ slug, displayName, description }))).toEqual([
      {
        slug: "content-production-orchestrator",
        displayName: "内容生产总控",
        description: "负责内容生产调度、阶段门禁、结果验收与最终交付。",
      },
      {
        slug: "evidence-research",
        displayName: "内容情报与证据",
        description: "负责公开素材捕获、选题研究、来源核验与证据整理。",
      },
      {
        slug: "editorial-production",
        displayName: "内容创作与编辑",
        description: "负责证据大纲、平台稿、保真审校与标题候选。",
      },
      {
        slug: "visual-production",
        displayName: "视觉内容生产",
        description: "负责正文配图规划、成套图片生成与公众号封面制作。",
      },
      {
        slug: "publishing-delivery",
        displayName: "发布包装与排版",
        description: "负责媒体优化候选、公众号 HTML 排版与发布前技术交付。",
      },
    ]);
  });

  it("packages a valid feedback-driven engineering team with four skill-routed members", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot })).resolves.toMatchObject({
      status: "seeded",
    });

    const snapshot = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "feedback-driven-engineering", ownership: "system" }),
    );
    expect(snapshot).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "反馈驱动工程团队",
        description: "以最短反馈循环推进软件目标；明确实现默认自动经过独立审查形成 merge-ready，提交、合并与外发仍由用户单独授权。",
        primaryAgentSlug: "delivery-lead",
        memberOrder: [
          "delivery-lead",
          "investigator",
          "implementer",
          "delivery-reviewer",
        ],
      },
    });
    await expect(readTeamOnboardingOrchestration({
      directory: snapshot.location.directory,
      memberOrder: snapshot.definition?.memberOrder ?? [],
    })).resolves.toMatchObject({
      status: "ready",
      source: "independent",
      orchestration: {
        version: 1,
        relayBeats: [
          { speakerSlug: "delivery-lead" },
          { speakerSlug: "investigator" },
          { speakerSlug: "implementer" },
          { speakerSlug: "delivery-reviewer" },
          { speakerSlug: "implementer" },
          { speakerSlug: "delivery-reviewer" },
          { speakerSlug: "delivery-lead" },
        ],
      },
    });
    expect(snapshot.members.map(({ slug, displayName, description }) => ({ slug, displayName, description }))).toEqual([
      {
        slug: "delivery-lead",
        displayName: "交付主理人",
        description: "负责目标澄清、流程选择、成员调度、提交决策和最终交付。",
      },
      {
        slug: "investigator",
        displayName: "调查员",
        description: "负责把事实、根因或设计不确定性收束成可交接的调查结论。",
      },
      {
        slug: "implementer",
        displayName: "实现者",
        description: "负责把已明确目标落实为最小、可维护且具有开发反馈证据的代码变更。",
      },
      {
        slug: "delivery-reviewer",
        displayName: "交付审查员",
        description: "负责静态审查、风险匹配的运行验收和唯一独立交付结论。",
      },
    ]);
  });

  it("packages a valid product development team with six ordered members", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot })).resolves.toMatchObject({
      status: "seeded",
    });

    const snapshot = await readTeamSnapshot(
      resolveTeamLocation({ dataRoot, teamId: "product-development", ownership: "system" }),
    );
    expect(snapshot).toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "产品研发闭环团队",
        primaryAgentSlug: "product-delivery-lead",
        memberOrder: [
          "product-delivery-lead",
          "product-reviewer",
          "ui-prototyper",
          "implementation-lead",
          "functional-qa",
          "visual-qa",
        ],
      },
    });
    await expect(readTeamOnboardingOrchestration({
      directory: snapshot.location.directory,
      memberOrder: snapshot.definition?.memberOrder ?? [],
    })).resolves.toMatchObject({
      status: "ready",
      source: "independent",
      orchestration: {
        version: 1,
        relayBeats: [
          { speakerSlug: "product-delivery-lead" },
          { speakerSlug: "product-reviewer" },
          { speakerSlug: "ui-prototyper" },
          { speakerSlug: "implementation-lead" },
          { speakerSlug: "functional-qa" },
          { speakerSlug: "implementation-lead" },
          { speakerSlug: "visual-qa" },
          { speakerSlug: "product-delivery-lead" },
        ],
      },
    });
    expect(snapshot.members.map(({ slug }) => slug)).toEqual(snapshot.definition?.memberOrder);
  });

  it("skips the entire seed flow when the packaged fingerprint matches", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });
    const developerAgent = path.join(
      getSystemTeamsRoot(dataRoot),
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.writeFile(developerAgent, "# 本地外部修改\n", "utf8");

    const result = await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });

    expect(result.status).toBe("skipped");
    expect(await fs.readFile(developerAgent, "utf8")).toBe("# 本地外部修改\n");
  });

  it("registers a packaged upgrade without overwriting editable official or user teams", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const firstSeed = path.join(root, "seed-v1");
    const secondSeed = path.join(root, "seed-v2");
    await writeTeamSeed(firstSeed, ["development", "removed-in-v2"], "v1");
    await writeTeamSeed(secondSeed, ["development"], "v2");
    await seedBuiltInTeams({ seedTeamsRoot: firstSeed, dataRoot });
    const userFile = path.join(dataRoot, "teams", "my-team", "opaque.bin");
    const userBytes = Buffer.from([0, 255, 17, 23, 42]);
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(userFile, userBytes);

    const result = await seedBuiltInTeams({ seedTeamsRoot: secondSeed, dataRoot });

    expect(result.status).toBe("skipped");
    await expect(fs.access(path.join(getSystemTeamsRoot(dataRoot), "removed-in-v2"))).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(getSystemTeamsRoot(dataRoot), "development", "version.txt"), "utf8")).toBe(
      "v1",
    );
    expect(await fs.readFile(path.join(
      getPackagedTeamCacheDirectory(dataRoot, "development"),
      "version.txt",
    ), "utf8")).toBe(
      "v2",
    );
    expect(await fs.readFile(userFile)).toEqual(userBytes);
  });

  it("does not use a missing legacy marker to overwrite an editable official team", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });
    const systemRoot = getSystemTeamsRoot(dataRoot);
    const markerPath = path.join(systemRoot, TEAMS_SEED_MARKER_FILE);
    const developerAgent = path.join(systemRoot, "development", "members", "dev", "AGENT.md");
    await fs.rm(markerPath);
    await fs.writeFile(developerAgent, "# 本地外部修改\n", "utf8");

    const result = await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });

    expect(result.status).toBe("skipped");
    expect(await fs.readFile(developerAgent, "utf8")).toBe("# 本地外部修改\n");
    expect((await fs.readFile(markerPath, "utf8")).trim()).toBe(
      await computeTeamSeedFingerprint(packagedSeedRoot),
    );
  });

  it("keeps the existing built-in subtree usable when new seed validation fails", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const invalidSeed = path.join(root, "invalid-seed");
    await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });
    const systemRoot = getSystemTeamsRoot(dataRoot);
    const before = await snapshotFiles(systemRoot);
    await fs.mkdir(invalidSeed, { recursive: true });
    await fs.writeFile(path.join(invalidSeed, TEAMS_SEED_MARKER_FILE), "reserved", "utf8");

    await expect(seedBuiltInTeams({ seedTeamsRoot: invalidSeed, dataRoot })).rejects.toThrow("reserved");

    expect(await snapshotFiles(systemRoot)).toEqual(before);
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-seed-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTeamSeed(root: string, teamIds: readonly string[], version: string): Promise<void> {
  for (const teamId of teamIds) {
    const teamRoot = path.join(root, teamId);
    const memberRoot = path.join(teamRoot, "members", "dev");
    await fs.mkdir(memberRoot, { recursive: true });
    await fs.writeFile(path.join(teamRoot, "team.json"), JSON.stringify({
      name: teamId,
      description: `seed ${version}`,
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    }, null, 2), "utf8");
    await fs.writeFile(path.join(memberRoot, "AGENT.md"), `# dev\n\n${version}\n`, "utf8");
    await fs.writeFile(path.join(teamRoot, "official.json"), JSON.stringify({
      schemaVersion: 1,
      officialVersion: version,
      members: {
        dev: {
          recommendedProfile: {
            cli: "codex",
            model: "gpt-5.6-sol",
            effort: "high",
          },
        },
      },
    }, null, 2), "utf8");
    await fs.writeFile(path.join(teamRoot, "version.txt"), version, "utf8");
  }
}

async function writeValidTeamDirectory(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, "members", "assistant"), { recursive: true });
  await fs.writeFile(path.join(root, "team.json"), JSON.stringify({
    name,
    description: "existing user team",
    primaryAgentSlug: "assistant",
    memberOrder: ["assistant"],
  }, null, 2), "utf8");
  await fs.writeFile(
    path.join(root, "members", "assistant", "AGENT.md"),
    "---\ndisplay_name: Existing assistant\ndescription: Existing user team\n---\n",
    "utf8",
  );
}

async function snapshotFiles(root: string, current = root): Promise<Array<[string, Buffer]>> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: Array<[string, Buffer]> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await snapshotFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push([path.relative(root, absolutePath), await fs.readFile(absolutePath)]);
    }
  }
  return files;
}
