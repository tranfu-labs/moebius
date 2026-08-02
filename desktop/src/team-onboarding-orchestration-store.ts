import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { TEAM_MANIFEST_FILE } from "./team-model.js";
import {
  TEAM_ONBOARDING_ORCHESTRATION_FILE,
  parseTeamOnboardingOrchestrationJson,
  planLegacyOnboardingPreservation,
  readLegacyEmbeddedOnboardingOrchestration,
  serializeTeamOnboardingOrchestration,
  type TeamOnboardingOrchestration,
  type TeamOnboardingOrchestrationReadResult,
} from "./team-onboarding-orchestration-plan.js";

export async function readTeamOnboardingOrchestration(input: {
  directory: string;
  memberOrder: readonly string[];
}): Promise<TeamOnboardingOrchestrationReadResult> {
  try {
    const source = await fs.readFile(
      path.join(input.directory, TEAM_ONBOARDING_ORCHESTRATION_FILE),
      "utf8",
    );
    try {
      return {
        status: "ready",
        source: "independent",
        orchestration: parseTeamOnboardingOrchestrationJson(source, input.memberOrder),
      };
    } catch {
      return { status: "invalid" };
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return { status: "invalid" };
    }
  }

  try {
    const manifestValue: unknown = JSON.parse(
      await fs.readFile(path.join(input.directory, TEAM_MANIFEST_FILE), "utf8"),
    );
    return readLegacyEmbeddedOnboardingOrchestration(manifestValue, input.memberOrder);
  } catch {
    return { status: "missing" };
  }
}

export async function writeTeamOnboardingOrchestration(
  directory: string,
  orchestration: TeamOnboardingOrchestration,
  memberOrder: readonly string[],
): Promise<void> {
  const normalized = parseTeamOnboardingOrchestrationJson(
    serializeTeamOnboardingOrchestration(orchestration),
    memberOrder,
  );
  await writeTextFileAtomically(
    path.join(directory, TEAM_ONBOARDING_ORCHESTRATION_FILE),
    serializeTeamOnboardingOrchestration(normalized),
  );
}

export async function preserveLegacyEmbeddedOnboardingOrchestration(
  directory: string,
): Promise<void> {
  try {
    await fs.access(path.join(directory, TEAM_ONBOARDING_ORCHESTRATION_FILE));
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  let source: string;
  try {
    source = await fs.readFile(path.join(directory, TEAM_MANIFEST_FILE), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const plan = planLegacyOnboardingPreservation(source);
  if (plan.status === "skip") {
    return;
  }
  await writeTeamOnboardingOrchestration(
    directory,
    plan.orchestration,
    plan.memberOrder,
  );
}

async function writeTextFileAtomically(filePath: string, source: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, source, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
