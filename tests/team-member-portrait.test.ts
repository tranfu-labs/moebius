import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tryReadLegacyAgentMarkdownPortrait } from "../desktop/src/team-model.js";
import {
  readTeamSnapshot,
  resolveTeamLocation,
  writeMemberAgentMarkdown,
  writeMemberTeamPortrait,
} from "../desktop/src/team-store.js";
import { parseMemberWriteRequest } from "../desktop/src/team-service-plan.js";
import { AgentTeamIpcRequestError } from "../desktop/src/team-ipc-contract.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeUserTeam(dataRoot: string, markdown: string): Promise<ReturnType<typeof resolveTeamLocation>> {
  const location = resolveTeamLocation({ dataRoot, teamId: "team-portrait", ownership: "user" });
  await fs.mkdir(path.join(location.directory, "members", "dev"), { recursive: true });
  await fs.writeFile(
    path.join(location.directory, "members", "dev", "AGENT.md"),
    markdown,
    "utf8",
  );
  await fs.writeFile(
    path.join(location.directory, "team.json"),
    JSON.stringify({
      name: "画像团队",
      description: "用于验证画像持久化",
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    }),
    "utf8",
  );
  return location;
}

function frontmatterMarkdown(portraitLine = ""): string {
  return `---
display_name: 开发
description: 负责实现
${portraitLine}---
# 开发

实现部分。\n`;
}

describe("member portrait persistence", () => {
  it("reads the legacy portrait_id from AGENT.md frontmatter and degrades leniently", () => {
    expect(tryReadLegacyAgentMarkdownPortrait(frontmatterMarkdown("portrait_id: cat-12\n"))).toBe("cat-12");
    expect(tryReadLegacyAgentMarkdownPortrait(frontmatterMarkdown())).toBeNull();
    expect(tryReadLegacyAgentMarkdownPortrait(frontmatterMarkdown("portrait_id: null\n"))).toBeNull();
    expect(tryReadLegacyAgentMarkdownPortrait(frontmatterMarkdown("portrait_id: [bad]\n"))).toBeNull();
    expect(tryReadLegacyAgentMarkdownPortrait("# 旧格式\n\n旧格式正文\n")).toBeNull();
    expect(tryReadLegacyAgentMarkdownPortrait("---\nbroken")).toBeNull();
  });

  it("writes a chosen face into team.json, strips the legacy AGENT.md field, and removes it on null", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown("portrait_id: cat-01\n"));

    await writeMemberTeamPortrait(location, "dev", "cat-12");
    const manifest = JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8")) as {
      memberPortraits?: Record<string, string>;
    };
    expect(manifest.memberPortraits).toEqual({ dev: "cat-12" });
    // The prompt file no longer carries app-side presentation metadata.
    const agentFile = await fs.readFile(
      path.join(location.directory, "members", "dev", "AGENT.md"),
      "utf8",
    );
    expect(agentFile).not.toContain("portrait_id");
    expect(agentFile).toContain("display_name: 开发");
    expect(agentFile).toContain("实现部分。");
    let snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId).toBe("cat-12");

    await writeMemberTeamPortrait(location, "dev", null);
    const cleared = JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8")) as {
      memberPortraits?: Record<string, string>;
    };
    expect(cleared.memberPortraits).toBeUndefined();
    snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId ?? null).toBeNull();
  });

  it("keeps a plain markdown save untouched by the portrait path and vice versa", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown());

    // A markdown save leaves the portrait record alone (none exists yet).
    await writeMemberAgentMarkdown(
      location,
      "dev",
      frontmatterMarkdown().replace("实现部分。", "实现部分。\n\n补充规则。"),
    );
    const afterMarkdownSave = await readTeamSnapshot(location);
    expect(afterMarkdownSave.members[0]?.portraitId ?? null).toBeNull();
    expect(afterMarkdownSave.members[0]?.agentMarkdown).toContain("补充规则。");

    // A portrait write does not rewrite the markdown body.
    await writeMemberTeamPortrait(location, "dev", "cat-21");
    const afterPortraitWrite = await readTeamSnapshot(location);
    expect(afterPortraitWrite.members[0]?.portraitId).toBe("cat-21");
    expect(afterPortraitWrite.members[0]?.agentMarkdown).toContain("补充规则。");
  });

  it("falls back to the legacy AGENT.md portrait until the portrait is next written", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    // Pre-migration team: the face lives in AGENT.md frontmatter, team.json has no portrait field.
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown("portrait_id: cat-08\n"));

    const snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId).toBe("cat-08");

    // Writing a new face migrates the record: team.json owns it, AGENT.md loses it.
    await writeMemberTeamPortrait(location, "dev", "cat-09");
    const migrated = await readTeamSnapshot(location);
    expect(migrated.members[0]?.portraitId).toBe("cat-09");
    const agentFile = await fs.readFile(
      path.join(location.directory, "members", "dev", "AGENT.md"),
      "utf8",
    );
    expect(agentFile).not.toContain("portrait_id");
  });

  it("rejects portrait writes for members outside the team and for missing manifests", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown());

    await expect(writeMemberTeamPortrait(location, "stranger", "cat-12")).rejects.toThrow(/只能为当前团队中的成员/);

    const emptyLocation = resolveTeamLocation({ dataRoot, teamId: "team-empty", ownership: "user" });
    await expect(writeMemberTeamPortrait(emptyLocation, "dev", "cat-12")).rejects.toThrow(/团队信息当前不可用/);
  });

  it("accepts exactly one of markdown or portrait in a member write request", () => {
    const base = { teamId: "team-portrait", ownership: "user" as const, memberSlug: "dev" };
    expect(parseMemberWriteRequest({ ...base, agentMarkdown: "# body\n" })).toEqual({
      ...base,
      agentMarkdown: "# body\n",
    });
    expect(parseMemberWriteRequest({ ...base, portraitId: "cat-12" })).toEqual({
      ...base,
      portraitId: "cat-12",
    });
    expect(parseMemberWriteRequest({ ...base, portraitId: null })).toEqual({
      ...base,
      portraitId: null,
    });
    expect(() => parseMemberWriteRequest({ ...base, agentMarkdown: "# body\n", portraitId: "cat-12" }))
      .toThrow(AgentTeamIpcRequestError);
    expect(() => parseMemberWriteRequest({ ...base })).toThrow(AgentTeamIpcRequestError);
    expect(() => parseMemberWriteRequest({ ...base, portraitId: "" })).toThrow(AgentTeamIpcRequestError);
    expect(() => parseMemberWriteRequest({ ...base, portraitId: 42 })).toThrow(AgentTeamIpcRequestError);
  });
});
