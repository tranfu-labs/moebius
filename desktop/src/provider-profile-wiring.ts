import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  createPiExecutionAdapter,
  PiProviderProfileUnavailableError,
} from "../../src/pi-execution-adapter.js";
import { PiHostClient } from "../../src/pi-host-client.js";
import { formatProviderTeamReferenceOwner, getProviderCatalogModel, normalizeProviderModel } from "../../src/provider-profile.js";
import { createSqliteProviderProfileStore } from "../../src/provider-profile-store.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import { createProviderCredentialVault } from "./provider-credential-vault.js";
import { createProviderProfileService } from "./provider-profile-service.js";
import { createProviderReferenceMutationPort } from "./provider-reference-mutation.js";
import { readAiTeamBuilderProviderReferences } from "./provider-reference-reader.js";
import type { AgentTeamService } from "./team-ipc.js";

export function createDesktopProviderProfileWiring(input: {
  dataRoot: string;
  dirname: string;
  agentTeamService: AgentTeamService;
  seedPending: () => boolean;
  getSessionRuntime(): {
    updateSessionMemberExecution(input: {
      sessionId: string;
      memberName: string;
      action: "migrate" | "end";
      executionProfile?: LocalConsoleExecutionProfile;
    }): Promise<unknown>;
  } | null;
}) {
  const store = createSqliteProviderProfileStore({
    sqlitePath: path.join(input.dataRoot, ".state", "local-console.sqlite"),
  });
  const vault = createProviderCredentialVault({
    filePath: path.join(input.dataRoot, ".state", "provider-credentials-v2.json"),
  });
  const hostEntryPath = path.join(input.dirname, "pi-host.js");
  const listReferences = async (profileId: string) => {
    const [sessionReferences, response, draftReferences] = await Promise.all([
      store.listSessionReferences(profileId),
      input.agentTeamService.listAgentTeams({
        dataRoot: input.dataRoot,
        seedPending: input.seedPending(),
      }),
      readAiTeamBuilderProviderReferences(input.dataRoot, profileId),
    ]);
    const teamReferences = response.status !== "ready" ? [] : response.teams.flatMap((team) =>
      team.members.flatMap((member) => {
        const profile = member.executionProfile?.effectiveProfile;
        return profile?.cli === "pi" && profile.providerProfileId === profileId
          ? [{
              kind: "team-member" as const,
              ownerId: formatProviderTeamReferenceOwner({
                ownership: team.ownership,
                teamId: team.id,
                memberSlug: member.slug,
              }),
              label: `${team.definition?.name ?? team.id} · ${member.displayName}`,
              profileId,
              model: normalizeProviderModel("deepseek", profile.model),
            }]
          : [];
      }));
    return [...teamReferences, ...draftReferences, ...sessionReferences];
  };
  const references = createProviderReferenceMutationPort({
    dataRoot: input.dataRoot,
    agentTeamService: input.agentTeamService,
    getSessionRuntime: input.getSessionRuntime,
    list: listReferences,
  });
  const service = createProviderProfileService({
    store,
    vault,
    validator: {
      async validate(validation) {
        const client = new PiHostClient({ hostEntryPath });
        await client.invoke({
          frame: {
            version: 1,
            type: "start",
            credential: { apiKey: validation.apiKey },
            invocation: {
              kind: "validate",
              providerId: validation.providerId,
              model: validation.model,
              effort: "high",
              cwd: input.dataRoot,
              agentDir: path.join(input.dataRoot, ".state", "pi-validation"),
            },
          },
          signal: validation.signal,
        });
      },
    },
    references,
    allocateProfileId: randomUUID,
  });
  const runPi = createPiExecutionAdapter({
    dataRoot: input.dataRoot,
    hostEntryPath,
    readCredential: async (profileId) => {
      const profile = await store.getProfile(profileId);
      if (profile === null) {
        throw new PiProviderProfileUnavailableError(
          "missing",
          "当前 Pi API 档案已不可用。请迁移当前会话，或仅本次换执行配置重跑。",
        );
      }
      if (profile.readiness === "disabled") {
        throw new PiProviderProfileUnavailableError(
          "disabled",
          "当前 Pi API 档案已停用。请重新启用后重试，或仅本次换执行配置重跑。",
        );
      }
      if (profile.readiness !== "ready") {
        throw new PiProviderProfileUnavailableError(
          "needs-attention",
          "当前 Pi API 档案需要处理。请前往设置修复后重试，或仅本次换执行配置重跑。",
        );
      }
      try {
        return await vault.read(profile.credentialRef);
      } catch {
        throw new PiProviderProfileUnavailableError(
          "needs-attention",
          "当前 Pi API 凭据暂时不可用。请前往设置修复后重试，或仅本次换执行配置重跑。",
        );
      }
    },
    reportProviderFailure: (profileId, reason) => service.recordRuntimeFailure(profileId, reason),
  });

  return {
    runPi,
    service,
    async resolveReadyExecutionProfile(): Promise<LocalConsoleExecutionProfile> {
      const profile = (await store.listProfiles()).find((candidate) => candidate.readiness === "ready");
      const model = profile?.defaultModel !== null && profile?.defaultModel !== undefined
        && profile.verifiedModels.includes(profile.defaultModel)
        ? profile.defaultModel
        : profile?.verifiedModels[0];
      if (profile === undefined || model === undefined) {
        throw new Error("没有已就绪的 CLI 或 API Provider 可用于 AI 建队。");
      }
      return {
        cli: "pi",
        providerId: profile.providerId,
        providerProfileId: profile.id,
        model,
        effort: getProviderCatalogModel(profile.providerId, model)?.defaultEffort ?? "high",
      };
    },
  };
}
