import type { ExecutionProfile } from "../team-execution-profile.js";

export interface AiTeamBuilderDriverRequest {
  dataRoot: string;
  draftId: string;
  prompt: string;
  profile: ExecutionProfile;
  externalSessionId: string | null;
  signal?: AbortSignal;
}

export type AiTeamBuilderDriverResult =
  | { ok: true; finalText: string; externalSessionId: string }
  | { ok: false; reason: string; resumeFailed: boolean };

export interface AiTeamBuilderDriverPort {
  execute(input: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult>;
}
