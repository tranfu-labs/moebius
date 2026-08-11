import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkAgentTeamMemberExternalChange } from "../src/team-external-change.js";
import { listRecordedUserTeamSnapshots, relocateUserTeamRecord } from "../src/team-record-store.js";
import { getMemberAgentPath, resolveTeamLocation } from "../src/team-store.js";
import { serializeTeamDefinition } from "../src/team-model.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent team external AGENT.md change detection", () => {
  it("checks only the requested user-team AGENT.md", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    const agentFile = getMemberAgentPath(location, "manager");
    const referencedFile = path.join(location.directory, "members", "manager", "notes.md");
    const original = "# 开发经理\n\n负责推进，参考 notes.md。\n";
    await fs.mkdir(path.dirname(agentFile), { recursive: true });
    await fs.writeFile(agentFile, original, "utf8");
    await fs.writeFile(referencedFile, "第一版\n", "utf8");

    const request = {
      teamId: "my-team",
      ownership: "user" as const,
      memberSlug: "manager",
      knownAgentMarkdown: original,
    };
    await fs.writeFile(referencedFile, "外部更新，但不应触发\n", "utf8");
    await expect(checkAgentTeamMemberExternalChange(dataRoot, request)).resolves.toEqual({ status: "unchanged" });

    const external = "# 新开发经理\n\n外部更新的职责。\n";
    await fs.writeFile(agentFile, external, "utf8");
    await expect(checkAgentTeamMemberExternalChange(dataRoot, request)).resolves.toEqual({
      status: "changed",
      document: {
        slug: "manager",
        displayName: "新开发经理",
        description: "外部更新的职责。",
        agentMarkdown: external,
      },
    });
  });

  it("reads and records official-team Finder changes with the known content as first-revision baseline", async () => {
    // Product-review blocker 2: built-in teams used to be silently ignored;
    // PRD requires the same revision structure for every team. The revision
    // must be durably persisted BEFORE the `changed` response returns.
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const agentFile = getMemberAgentPath(location, "manager");
    const original = "# 开发经理\n\n负责技术决策。\n";
    await fs.mkdir(path.dirname(agentFile), { recursive: true });
    await fs.writeFile(agentFile, original, "utf8");

    const request = {
      teamId: "development",
      ownership: "system" as const,
      memberSlug: "manager",
      knownAgentMarkdown: original,
    };
    await expect(checkAgentTeamMemberExternalChange(dataRoot, request)).resolves.toEqual({ status: "unchanged" });

    const external = "# 开发经理\n\n负责技术决策与质量把关。\n";
    await fs.writeFile(agentFile, external, "utf8");
    const revisions: unknown[] = [];
    const response = await checkAgentTeamMemberExternalChange(dataRoot, request, {
      recordMemberRevision: async (input) => {
        revisions.push(input);
        return { revisionId: "rev-1" } as never;
      },
    });
    expect(response).toMatchObject({ status: "changed" });
    // The revision was awaited before the response: the caller can rely on it
    // being on disk, and it carries the app's last known content as the
    // baseline so markers reflect only the actual change.
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      teamStableId: "development",
      memberSlug: "manager",
      content: external,
      authorKind: "user",
      baselineContent: original,
    });
  });

  it("checks a relocated user team through its recorded external location", async () => {
    const dataRoot = await makeDataRoot();
    const original = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    const agentFile = getMemberAgentPath(original, "manager");
    await fs.mkdir(path.dirname(agentFile), { recursive: true });
    await fs.writeFile(path.join(original.directory, "team.json"), serializeTeamDefinition({
      name: "开发团队",
      description: "负责开发",
      primaryAgentSlug: "manager",
      memberOrder: ["manager"],
    }), "utf8");
    const originalMarkdown = "# 开发经理\n\n负责开发\n";
    await fs.writeFile(agentFile, originalMarkdown, "utf8");
    await listRecordedUserTeamSnapshots(dataRoot);
    const external = path.join(dataRoot, "external-teams", "renamed-team");
    await fs.mkdir(path.dirname(external), { recursive: true });
    await fs.rename(original.directory, external);
    await relocateUserTeamRecord({ dataRoot, teamId: "my-team", directory: external });
    await fs.writeFile(path.join(external, "members", "manager", "AGENT.md"), "# 新经理\n\n外部位置更新\n", "utf8");

    await expect(checkAgentTeamMemberExternalChange(dataRoot, {
      teamId: "my-team",
      ownership: "user",
      memberSlug: "manager",
      knownAgentMarkdown: originalMarkdown,
    })).resolves.toMatchObject({
      status: "changed",
      document: { displayName: "新经理", description: "外部位置更新" },
    });
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-external-change-"));
  temporaryRoots.push(root);
  return root;
}
