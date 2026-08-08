import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseAgentMarkdownIdentity } from "../desktop/src/team-model.js";
import {
  readTeamSnapshot,
  resolveTeamLocation,
  writeMemberAgentMarkdown,
  writeMemberAgentPortrait,
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
  it("reads portrait_id from AGENT.md frontmatter and degrades leniently", () => {
    expect(parseAgentMarkdownIdentity(frontmatterMarkdown("portrait_id: cat-12\n"))).toMatchObject({
      displayName: "开发",
      description: "负责实现",
      portraitId: "cat-12",
    });
    expect(parseAgentMarkdownIdentity(frontmatterMarkdown())).not.toHaveProperty("portraitId");
    expect(parseAgentMarkdownIdentity(frontmatterMarkdown("portrait_id: null\n"))).toEqual(
      expect.objectContaining({ portraitId: null }),
    );
    expect(parseAgentMarkdownIdentity(frontmatterMarkdown("portrait_id: [bad]\n"))).toEqual(
      expect.objectContaining({ portraitId: null }),
    );
    expect(parseAgentMarkdownIdentity("# 旧格式\n\n旧格式正文\n")).not.toHaveProperty("portraitId");
  });

  it("writes a chosen face into the file, surfaces it in the team snapshot, and removes it on null", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown());

    await writeMemberAgentPortrait(location, "dev", "cat-12");
    let agentFile = await fs.readFile(
      path.join(location.directory, "members", "dev", "AGENT.md"),
      "utf8",
    );
    expect(agentFile).toContain("portrait_id: cat-12");
    expect(agentFile).toContain("# 开发");
    expect(agentFile).toContain("实现部分。");
    let snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId).toBe("cat-12");

    await writeMemberAgentPortrait(location, "dev", null);
    agentFile = await fs.readFile(
      path.join(location.directory, "members", "dev", "AGENT.md"),
      "utf8",
    );
    expect(agentFile).not.toContain("portrait_id");
    expect(agentFile).toContain("display_name: 开发");
    expect(agentFile).toContain("实现部分。");
    snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId ?? null).toBeNull();
  });

  it("keeps a plain markdown save untouched by the portrait path and vice versa", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, frontmatterMarkdown());

    await writeMemberAgentMarkdown(location, "dev", frontmatterMarkdown("portrait_id: cat-03\n").replace("实现部分。", "实现部分。\n\n补充规则。"));
    const afterMarkdownSave = await readTeamSnapshot(location);
    expect(afterMarkdownSave.members[0]?.portraitId).toBe("cat-03");
    expect(afterMarkdownSave.members[0]?.agentMarkdown).toContain("补充规则。");

    await writeMemberAgentPortrait(location, "dev", "cat-21");
    const afterPortraitWrite = await readTeamSnapshot(location);
    expect(afterPortraitWrite.members[0]?.portraitId).toBe("cat-21");
    expect(afterPortraitWrite.members[0]?.agentMarkdown).toContain("补充规则。");
  });

  it("adds a frontmatter block when a legacy member has none", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-portrait-"));
    temporaryRoots.push(dataRoot);
    const location = await makeUserTeam(dataRoot, "# 旧格式\n\n旧格式正文。\n");

    await writeMemberAgentPortrait(location, "dev", "cat-08");
    const agentFile = await fs.readFile(
      path.join(location.directory, "members", "dev", "AGENT.md"),
      "utf8",
    );
    expect(agentFile).toContain("portrait_id: cat-08");
    expect(agentFile).toContain("旧格式正文。");
    const snapshot = await readTeamSnapshot(location);
    expect(snapshot.members[0]?.portraitId).toBe("cat-08");
    expect(snapshot.members[0]?.displayName).toBe("旧格式");
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
