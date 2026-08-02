import type { AiTeamBuilderDraft } from "./state-machine.js";

export interface AiTeamBuilderDraftFilePort {
  read(draftId: string): Promise<string | null>;
  write(draft: AiTeamBuilderDraft): Promise<void>;
}

export interface AiTeamBuilderDraftRepositoryPort {
  load(
    draftId: string,
    options?: { recoverInterrupted?: boolean },
  ): Promise<AiTeamBuilderDraft>;
  save(draft: AiTeamBuilderDraft): Promise<void>;
}
