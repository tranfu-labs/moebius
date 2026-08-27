import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LocalConsoleSessionSummary } from "../../src/local-console/types.js";
import { serializeTeamDefinition } from "../src/team-model.js";
import {
  AgentTeamRosterUnavailableError,
  createTeamRuntimeBindingService,
} from "../src/team-runtime-binding.js";
import { listSharedAgentFiles } from "../src/team-shared-agent-store.js";
import { resolveRecordedTeamLocation } from "../src/team-record-store.js";
import {
  getOfficialTeamStatePath,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  writeExecutionBindingDocument,
  writeOfficialTeamStateDocument,
} from "../src/team-management-store.js";
import { readTeamSnapshot, resolveTeamLocation } from "../src/team-store.js";
import { registerUserTeamSnapshot } from "../src/team-record-store.js";

const roots: string[] = [];
const runtimeBinding = createTeamRuntimeBindingService({
  listSharedAgents: listSharedAgentFiles,
  resolveSystemLocation: ({ dataRoot, teamId }) => resolveTeamLocation({
    dataRoot,
    teamId,
    ownership: "system",
  }),
  resolveUserLocation: resolveRecordedTeamLocation,
  readSnapshot: readTeamSnapshot,
  readBindings: readTeamExecutionBindings,
  readOfficialState: readOfficialTeamStateDocument,
});
const {
  listSessionAgentFiles,
  loadAgentTeamSnapshot,
  resolveSessionAgentTeamHealth,
} = runtimeBinding;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("session-scoped Agent team runtime binding", () => {
  it("returns exactly the members of a bound team and excludes shared-only agents", async () => {
    const dataRoot = await makeDataRoot();
    await writeSharedAgent(dataRoot, "ceo");
    const team = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await writeTeam(team.directory, ["dev-manager", "dev", "qa"]);

    await expect(listSessionAgentFiles({
      dataRoot,
      session: session({ ownership: "system", id: "development" }),
    })).resolves.toEqual([
      expect.objectContaining({ name: "dev-manager" }),
      expect.objectContaining({ name: "dev" }),
      expect.objectContaining({ name: "qa" }),
    ]);
  });

  it("falls back to the shared directory only for an unbound legacy session", async () => {
    const dataRoot = await makeDataRoot();
    await writeSharedAgent(dataRoot, "ceo");

    await expect(listSessionAgentFiles({ dataRoot, session: session() })).resolves.toEqual([
      { name: "ceo", path: path.join(dataRoot, "agents", "ceo.md") },
    ]);
    await expect(resolveSessionAgentTeamHealth({ dataRoot, session: session() })).resolves.toEqual({
      health: "usable",
      reason: null,
    });
  });

  it("reports a bound unavailable team explicitly and exposes repair health", async () => {
    const dataRoot = await makeDataRoot();
    const bound = session({ ownership: "system", id: "missing-team" });

    await expect(listSessionAgentFiles({ dataRoot, session: bound })).rejects.toBeInstanceOf(
      AgentTeamRosterUnavailableError,
    );
    await expect(resolveSessionAgentTeamHealth({ dataRoot, session: bound })).resolves.toMatchObject({
      health: "needs-repair",
      reason: expect.stringContaining("missing"),
    });
  });

  it("loads immutable Agent markdown content for a conversation snapshot", async () => {
    const dataRoot = await makeDataRoot();
    const team = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await writeTeam(team.directory, ["dev"]);

    const loaded = await loadAgentTeamSnapshot({
      dataRoot,
      ownership: "system",
      teamId: "development",
    });
    await fs.writeFile(path.join(team.directory, "members", "dev", "AGENT.md"), "# dev\n\nchanged later\n", "utf8");

    expect(loaded.members).toEqual([
      {
        name: "dev",
        displayName: "dev",
        description: "负责 dev",
        agentMarkdown: "# dev\n\n负责 dev\n",
        portraitId: null,
        executionProfile: {
          cli: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      },
    ]);
  });

  it("does not read legacy official state for a new user team", async () => {
    const dataRoot = await makeDataRoot();
    const team = resolveTeamLocation({ dataRoot, teamId: "team-user", ownership: "user" });
    await writeTeam(team.directory, ["dev"]);
    await registerUserTeamSnapshot(await readTeamSnapshot(team));
    await fs.mkdir(path.dirname(getOfficialTeamStatePath(dataRoot)), { recursive: true });
    await fs.writeFile(getOfficialTeamStatePath(dataRoot), "not-json\n", "utf8");

    await expect(loadAgentTeamSnapshot({
      dataRoot,
      ownership: "user",
      teamId: "team-user",
    })).resolves.toMatchObject({
      team: { ownership: "user", id: "team-user" },
      members: [{
        name: "dev",
        executionProfile: {
          cli: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      }],
    });
  });

  it("keeps the legacy official recommendation fallback for a system team", async () => {
    const dataRoot = await makeDataRoot();
    const team = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await writeTeam(team.directory, ["dev"]);
    await writeExecutionBindingDocument(dataRoot, {
      schemaVersion: 1,
      teams: {
        "system:development": {
          ownership: "system",
          members: { dev: { source: "recommended" } },
        },
      },
    });
    await writeOfficialTeamStateDocument(dataRoot, {
      schemaVersion: 1,
      teams: {
        development: {
          appliedOfficialVersion: "legacy",
          appliedContentFingerprint: "content",
          appliedRecommendationFingerprint: "recommendation",
          appliedRecommendations: {
            dev: { cli: "claude", model: "sonnet", effort: "medium" },
          },
          baselineConfidence: "verified",
        },
      },
    });

    await expect(loadAgentTeamSnapshot({
      dataRoot,
      ownership: "system",
      teamId: "development",
    })).resolves.toMatchObject({
      members: [{
        name: "dev",
        executionProfile: {
          cli: "claude",
          model: "sonnet",
          effort: "medium",
        },
      }],
    });
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-runtime-"));
  roots.push(root);
  return root;
}

function session(binding?: { ownership: "system" | "user"; id: string }): LocalConsoleSessionSummary {
  return {
    sessionId: "local:test",
    projectId: "local",
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: "test",
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    agentTeamOwnership: binding?.ownership ?? null,
    agentTeamId: binding?.id ?? null,
  };
}

async function writeSharedAgent(dataRoot: string, role: string): Promise<void> {
  await fs.mkdir(path.join(dataRoot, "agents"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "agents", `${role}.md`), `# ${role}\n`, "utf8");
}

async function writeTeam(directory: string, roles: string[]): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "team.json"), serializeTeamDefinition({
    name: "开发团队",
    description: "负责开发",
    primaryAgentSlug: roles[0]!,
    memberOrder: roles,
  }), "utf8");
  await Promise.all(roles.map(async (role) => {
    const memberDirectory = path.join(directory, "members", role);
    await fs.mkdir(memberDirectory, { recursive: true });
    await fs.writeFile(path.join(memberDirectory, "AGENT.md"), `# ${role}\n\n负责 ${role}\n`, "utf8");
  }));
}
