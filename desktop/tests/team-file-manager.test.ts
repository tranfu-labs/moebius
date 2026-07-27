import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentTeamFileManagerError,
  getAgentTeamFileManagerKind,
  openAgentTeamLocationInFileManager,
} from "../src/team-file-manager.js";
import { listRecordedUserTeamSnapshots, relocateUserTeamRecord } from "../src/team-record-store.js";
import { getMemberDirectory, resolveTeamLocation } from "../src/team-store.js";
import { serializeTeamDefinition } from "../src/team-model.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent team file manager", () => {
  it("exposes stable platform kinds instead of localized preload copy", () => {
    expect(getAgentTeamFileManagerKind("darwin")).toBe("finder");
    expect(getAgentTeamFileManagerKind("win32")).toBe("windows-explorer");
    expect(getAgentTeamFileManagerKind("linux")).toBe("file-manager");
  });

  it("opens the team directory and the selected member directory", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    const memberDirectory = getMemberDirectory(location, "manager");
    await fs.mkdir(memberDirectory, { recursive: true });
    const openPath = vi.fn().mockResolvedValue("");

    await openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "my-team", ownership: "user" },
      shell: { openPath },
    });
    await openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "my-team", ownership: "user", memberSlug: "manager" },
      shell: { openPath },
    });

    expect(openPath).toHaveBeenNthCalledWith(1, location.directory);
    expect(openPath).toHaveBeenNthCalledWith(2, memberDirectory);
  });

  it("allows a built-in location to be viewed without modifying its contents", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const memberDirectory = getMemberDirectory(location, "manager");
    await fs.mkdir(memberDirectory, { recursive: true });
    const agentPath = path.join(memberDirectory, "AGENT.md");
    await fs.writeFile(agentPath, "# 开发经理\n", "utf8");
    const openPath = vi.fn().mockResolvedValue("");

    await openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "development", ownership: "system", memberSlug: "manager" },
      shell: { openPath },
    });

    expect(openPath).toHaveBeenCalledWith(memberDirectory);
    await expect(fs.readFile(agentPath, "utf8")).resolves.toBe("# 开发经理\n");
  });

  it("opens a user team through its recorded external location after relocation", async () => {
    const dataRoot = await makeDataRoot();
    const original = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    const agentDirectory = getMemberDirectory(original, "manager");
    await fs.mkdir(agentDirectory, { recursive: true });
    await fs.writeFile(path.join(original.directory, "team.json"), serializeTeamDefinition({
      name: "开发团队",
      description: "负责开发",
      primaryAgentSlug: "manager",
      memberOrder: ["manager"],
    }), "utf8");
    await fs.writeFile(path.join(agentDirectory, "AGENT.md"), "# 开发经理\n\n负责开发\n", "utf8");
    await listRecordedUserTeamSnapshots(dataRoot);
    const external = path.join(dataRoot, "external-teams", "renamed-team");
    await fs.mkdir(path.dirname(external), { recursive: true });
    await fs.rename(original.directory, external);
    await relocateUserTeamRecord({ dataRoot, teamId: "my-team", directory: external });
    const openPath = vi.fn().mockResolvedValue("");

    await openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "my-team", ownership: "user" },
      shell: { openPath },
    });

    expect(openPath).toHaveBeenCalledWith(external);
  });

  it("replaces missing, inaccessible, and shell errors with a stable error code", async () => {
    const dataRoot = await makeDataRoot();
    const openPath = vi.fn().mockRejectedValue(new Error("EACCES /private/internal/path"));

    await expect(openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "missing", ownership: "user" },
      shell: { openPath },
    })).rejects.toMatchObject({
      name: "AgentTeamFileManagerError",
      code: "AGENT_TEAM_FILE_MANAGER_OPEN_FAILED",
    } satisfies Partial<AgentTeamFileManagerError>);
    expect(openPath).not.toHaveBeenCalled();

    const location = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    await fs.mkdir(location.directory, { recursive: true });
    const shellFailure = await openAgentTeamLocationInFileManager({
      dataRoot,
      request: { teamId: "my-team", ownership: "user" },
      shell: { openPath },
    }).catch((error: unknown) => error);
    expect(shellFailure).toBeInstanceOf(AgentTeamFileManagerError);
    expect((shellFailure as AgentTeamFileManagerError).code).toBe(
      "AGENT_TEAM_FILE_MANAGER_OPEN_FAILED",
    );
    expect((shellFailure as Error).message).not.toMatch(/EACCES|private|internal/u);
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-file-manager-"));
  cleanupRoots.push(root);
  return root;
}
