import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getSystemTeamsRoot, readTeamSnapshot, resolveTeamLocation } from "../src/team-store.js";
import {
  TEAMS_SEED_MARKER_FILE,
  computeTeamSeedFingerprint,
  seedBuiltInTeams,
} from "../src/team-seed.js";
import { readTeamOnboardingOrchestration } from "../src/team-onboarding-orchestration.js";
import { getPackagedTeamCacheDirectory } from "../src/team-management-store.js";

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
        description: "以最短反馈循环推进软件目标，并在明确收尾时通过独立审查和风险匹配的运行验收形成可提交的交付闭环。",
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
