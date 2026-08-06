import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  getProviderCatalogModel,
  parseEffectiveProviderSessionReferenceOwner,
  planProviderTeamReferenceGroups,
  type DeepSeekModelId,
  type ProviderProfile,
  type ProviderReference,
} from "../../src/provider-profile.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import type { ProviderReferencePort } from "./provider-profile-service.js";
import type { AgentTeamService } from "./team-ipc.js";

interface SessionExecutionMutationPort {
  updateSessionMemberExecution(input: {
    sessionId: string;
    memberName: string;
    action: "migrate" | "end";
    executionProfile?: LocalConsoleExecutionProfile;
  }): Promise<unknown>;
}

export function createProviderReferenceMutationPort(input: {
  dataRoot: string;
  agentTeamService: AgentTeamService;
  getSessionRuntime(): SessionExecutionMutationPort | null;
  list(profileId: string): Promise<ProviderReference[]>;
}): ProviderReferencePort {
  return {
    list: input.list,
    async migrate(request) {
      const executionProfile = createTargetExecutionProfile(
        request.targetProfile,
        request.targetModel,
      );
      const teamGroups = planProviderTeamReferenceGroups(request.references);
      for (const group of teamGroups) {
        await input.agentTeamService.replaceUnavailableAgentTeamExecutionProfiles(
          input.dataRoot,
          {
            teamId: group.teamId,
            ownership: group.ownership,
            memberSlugs: group.memberSlugs,
            profile: executionProfile,
          },
        );
        await request.onCommitted(group.ownerIds);
      }
      for (const reference of request.references.filter((candidate) => candidate.kind === "team-builder-draft")) {
        await migrateDraft(input.dataRoot, reference.ownerId, executionProfile);
        await request.onCommitted([reference.ownerId]);
      }
      for (const reference of request.references.filter((candidate) => candidate.kind === "resumable-session")) {
        const runtime = requireSessionRuntime(input.getSessionRuntime());
        const owner = parseEffectiveProviderSessionReferenceOwner(reference.ownerId);
        await runtime.updateSessionMemberExecution({
          sessionId: owner.sessionId,
          memberName: owner.memberName,
          action: "migrate",
          executionProfile,
        });
        await request.onCommitted([reference.ownerId]);
      }
      assertNoUnsupportedReferences(request.references);
    },
    async end(request) {
      for (const reference of request.references) {
        if (reference.kind === "team-builder-draft") {
          await endDraft(input.dataRoot, reference.ownerId);
        } else if (reference.kind === "resumable-session") {
          const runtime = requireSessionRuntime(input.getSessionRuntime());
          const owner = parseEffectiveProviderSessionReferenceOwner(reference.ownerId);
          await runtime.updateSessionMemberExecution({
            sessionId: owner.sessionId,
            memberName: owner.memberName,
            action: "end",
          });
        } else {
          throw new Error("This Provider reference cannot end continuation");
        }
        await request.onCommitted([reference.ownerId]);
      }
    },
  };
}

function createTargetExecutionProfile(
  profile: ProviderProfile,
  model: DeepSeekModelId,
): LocalConsoleExecutionProfile {
  return {
    cli: "pi",
    providerId: profile.providerId,
    providerProfileId: profile.id,
    model,
    effort: getProviderCatalogModel(profile.providerId, model)?.defaultEffort ?? "high",
  };
}

async function migrateDraft(
  dataRoot: string,
  draftId: string,
  executionProfile: LocalConsoleExecutionProfile,
): Promise<void> {
  await updateDraft(dataRoot, draftId, (draft) => ({
    ...draft,
    executionProfile,
    externalSessionId: null,
    continuationEnded: false,
    messages: appendDraftSystemMessage(
      draft.messages,
      "执行配置已迁移。既有建队内容已保留，下一轮将建立新的 Pi 上下文。",
    ),
  }));
}

async function endDraft(dataRoot: string, draftId: string): Promise<void> {
  await updateDraft(dataRoot, draftId, (draft) => ({
    ...draft,
    continuationEnded: true,
    externalSessionId: null,
    pendingPrompt: null,
    messages: appendDraftSystemMessage(
      draft.messages,
      "已结束继续能力。既有建队内容保留为只读历史。",
    ),
  }));
}

async function updateDraft(
  dataRoot: string,
  draftId: string,
  update: (draft: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/u.test(draftId)) throw new Error("AI team builder draft identity is invalid");
  const filePath = path.join(path.resolve(dataRoot), ".state", "ai-team-builder-drafts", `${draftId}.json`);
  const draft = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!isRecord(draft) || draft.draftId !== draftId || draft.phase === "selected") {
    throw new Error("AI team builder draft is no longer migratable");
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(update(draft), null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function appendDraftSystemMessage(value: unknown, text: string): unknown[] {
  const messages = Array.isArray(value) ? value : [];
  return [...messages, { role: "assistant", text }];
}

function requireSessionRuntime(runtime: SessionExecutionMutationPort | null): SessionExecutionMutationPort {
  if (runtime === null) throw new Error("Local console is unavailable for Provider reference migration");
  return runtime;
}

function assertNoUnsupportedReferences(references: readonly ProviderReference[]): void {
  const unsupported = references.filter((reference) =>
    reference.kind === "queued-task" || reference.kind === "single-run"
  );
  if (unsupported.length > 0) {
    throw new Error("Running or queued Provider references must finish or stop before migration");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
