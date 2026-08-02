import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  TEAM_ONBOARDING_ORCHESTRATION_FILE,
  parseTeamOnboardingOrchestrationJson,
} from "../src/team-onboarding-orchestration.js";
import {
  readTeamOnboardingOrchestration,
  writeTeamOnboardingOrchestration,
} from "../src/team-onboarding-orchestration-store.js";
import { resolveTeamLocation, writeTeamDefinition } from "../src/team-store.js";

const temporaryRoots: string[] = [];
const memberOrder = ["manager", "developer"];
const relayBeats = [
  { speakerSlug: "manager", message: "拆解任务。" },
  { speakerSlug: "developer", message: "完成实现。" },
];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("team onboarding orchestration", () => {
  it("strictly parses and atomically round-trips an independent versioned file", async () => {
    const directory = await makeTeamDirectory();

    await writeTeamOnboardingOrchestration(directory, {
      version: 1,
      relayBeats,
    }, memberOrder);

    await expect(readTeamOnboardingOrchestration({ directory, memberOrder })).resolves.toEqual({
      status: "ready",
      source: "independent",
      orchestration: { version: 1, relayBeats },
    });
    expect(parseTeamOnboardingOrchestrationJson(
      await fs.readFile(path.join(directory, TEAM_ONBOARDING_ORCHESTRATION_FILE), "utf8"),
      memberOrder,
    )).toEqual({ version: 1, relayBeats });
  });

  it("returns missing or invalid locally without changing team core semantics", async () => {
    const directory = await makeTeamDirectory();

    await expect(readTeamOnboardingOrchestration({ directory, memberOrder })).resolves.toEqual({
      status: "missing",
    });

    await fs.writeFile(
      path.join(directory, TEAM_ONBOARDING_ORCHESTRATION_FILE),
      JSON.stringify({
        version: 1,
        relayBeats: [{ speakerSlug: "reviewer", message: "越界发言。" }],
      }),
      "utf8",
    );
    await expect(readTeamOnboardingOrchestration({ directory, memberOrder })).resolves.toEqual({
      status: "invalid",
    });
  });

  it("reads recent embedded relay data only when the independent file is absent", async () => {
    const directory = await makeTeamDirectory();
    await fs.writeFile(path.join(directory, "team.json"), JSON.stringify({
      name: "开发团队",
      description: "负责开发",
      primaryAgentSlug: "manager",
      memberOrder,
      relayBeats,
    }), "utf8");

    await expect(readTeamOnboardingOrchestration({ directory, memberOrder })).resolves.toEqual({
      status: "ready",
      source: "embedded",
      orchestration: { version: 1, relayBeats },
    });

    await fs.writeFile(
      path.join(directory, TEAM_ONBOARDING_ORCHESTRATION_FILE),
      "{broken",
      "utf8",
    );
    await expect(readTeamOnboardingOrchestration({ directory, memberOrder })).resolves.toEqual({
      status: "invalid",
    });
  });

  it("migrates valid embedded relay data before rewriting a user team manifest", async () => {
    const dataRoot = await makeRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "legacy-team", ownership: "user" });
    await fs.mkdir(location.directory, { recursive: true });
    await fs.writeFile(path.join(location.directory, "team.json"), `${JSON.stringify({
      name: "开发团队",
      description: "旧描述",
      primaryAgentSlug: "manager",
      memberOrder,
      relayBeats,
    }, null, 2)}\n`, "utf8");

    await writeTeamDefinition(location, {
      name: "开发团队",
      description: "新描述",
      primaryAgentSlug: "manager",
      memberOrder,
    });

    expect(JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8"))).toEqual({
      name: "开发团队",
      description: "新描述",
      primaryAgentSlug: "manager",
      memberOrder,
    });
    await expect(readTeamOnboardingOrchestration({
      directory: location.directory,
      memberOrder,
    })).resolves.toEqual({
      status: "ready",
      source: "independent",
      orchestration: { version: 1, relayBeats },
    });
  });

  it("still allows a damaged legacy manifest to be replaced with a valid core definition", async () => {
    const dataRoot = await makeRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "repair-team", ownership: "user" });
    await fs.mkdir(location.directory, { recursive: true });
    await fs.writeFile(path.join(location.directory, "team.json"), "{damaged", "utf8");

    await expect(writeTeamDefinition(location, {
      name: "修复团队",
      description: "恢复核心定义",
      primaryAgentSlug: null,
      memberOrder: [],
    })).resolves.toBeUndefined();
    expect(JSON.parse(await fs.readFile(path.join(location.directory, "team.json"), "utf8"))).toEqual({
      name: "修复团队",
      description: "恢复核心定义",
      primaryAgentSlug: null,
      memberOrder: [],
    });
  });
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-orchestration-"));
  temporaryRoots.push(root);
  return root;
}

async function makeTeamDirectory(): Promise<string> {
  const root = await makeRoot();
  const directory = path.join(root, "team");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "team.json"), JSON.stringify({
    name: "开发团队",
    description: "负责开发",
    primaryAgentSlug: "manager",
    memberOrder,
  }), "utf8");
  return directory;
}
