import { CODEX_MODEL } from "../../../src/config.js";
import { probeExecutionCapabilities } from "../execution-capabilities.js";
import type {
  ExecutionCapabilityModel,
  ExecutionCapabilitySnapshot,
  ExecutionProfile,
} from "../team-execution-profile.js";

export type AiTeamBuilderExecutionProfileResolver = () => Promise<ExecutionProfile>;

export async function resolveAiTeamBuilderExecutionProfile(): Promise<ExecutionProfile> {
  const codex = await probeExecutionCapabilities({ cli: "codex" });
  if (codex.status === "available") {
    return selectProfile(codex, CODEX_MODEL);
  }
  const kimi = await probeExecutionCapabilities({ cli: "kimi" });
  if (kimi.status === "available") {
    return selectProfile(kimi);
  }
  const claude = await probeExecutionCapabilities({ cli: "claude" });
  if (claude.status === "available") {
    return selectProfile(claude, "sonnet");
  }
  throw new AiTeamBuilderExecutionProfileError(
    "Codex、Kimi 和 Claude 当前都未通过服务端就绪检查。",
  );
}

export function selectAiTeamBuilderProfileFromSnapshots(input: {
  codex: ExecutionCapabilitySnapshot;
  kimi: ExecutionCapabilitySnapshot;
  claude: ExecutionCapabilitySnapshot;
  preferredCodexModel?: string;
}): ExecutionProfile {
  if (input.codex.status === "available") {
    return selectProfile(input.codex, input.preferredCodexModel ?? CODEX_MODEL);
  }
  if (input.kimi.status === "available") {
    return selectProfile(input.kimi);
  }
  if (input.claude.status === "available") {
    return selectProfile(input.claude, "sonnet");
  }
  throw new AiTeamBuilderExecutionProfileError(
    "Codex、Kimi 和 Claude 当前都未通过服务端就绪检查。",
  );
}

export function selectAiTeamBuilderProfileFromSnapshot(
  snapshot: ExecutionCapabilitySnapshot,
  preferredModel?: string,
): ExecutionProfile {
  if (snapshot.status !== "available") {
    throw new AiTeamBuilderExecutionProfileError(
      `${snapshot.cli} 当前未通过服务端就绪检查。`,
    );
  }
  return selectProfile(
    snapshot,
    preferredModel ?? (
      snapshot.cli === "codex"
        ? CODEX_MODEL
        : snapshot.cli === "claude"
          ? "sonnet"
          : undefined
    ),
  );
}

function selectProfile(
  snapshot: ExecutionCapabilitySnapshot,
  preferredModel?: string,
): ExecutionProfile {
  const model = snapshot.models.find((candidate) => candidate.id === preferredModel)
    ?? snapshot.models[0];
  if (model === undefined) {
    throw new AiTeamBuilderExecutionProfileError(
      `${snapshot.cli} 没有可用于 AI 建队的模型。`,
    );
  }
  const effort = selectEffort(model);
  if (effort === null) {
    throw new AiTeamBuilderExecutionProfileError(
      `${snapshot.cli} 的模型没有可用思考程度。`,
    );
  }
  return { cli: snapshot.cli, model: model.id, effort };
}

function selectEffort(model: ExecutionCapabilityModel): string | null {
  if (model.defaultEffort !== null && model.efforts.includes(model.defaultEffort)) {
    return model.defaultEffort;
  }
  return model.efforts.includes("high") ? "high" : (model.efforts[0] ?? null);
}

export class AiTeamBuilderExecutionProfileError extends Error {
  readonly code = "AI_TEAM_BUILDER_EXECUTION_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderExecutionProfileError";
  }
}
