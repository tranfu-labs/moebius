import type { ExecutionProfile } from "../team-execution-profile.js";
import {
  assertAiTeamBuilderDraftId,
  planAiTeamBuilderStoredDraft,
} from "./draft-persistence-plan.js";
import type {
  AiTeamBuilderDraftFilePort,
  AiTeamBuilderDraftRepositoryPort,
} from "./draft-store-contract.js";
import type { AiTeamBuilderDraft } from "./state-machine.js";

export class AiTeamBuilderDraftRepository implements AiTeamBuilderDraftRepositoryPort {
  constructor(
    private readonly files: AiTeamBuilderDraftFilePort,
    private readonly legacyExecutionProfile: ExecutionProfile,
  ) {}

  async load(
    draftId: string,
    options: { recoverInterrupted?: boolean } = {},
  ): Promise<AiTeamBuilderDraft> {
    assertAiTeamBuilderDraftId(draftId);
    const loadPlan = planAiTeamBuilderStoredDraft({
      source: await this.files.read(draftId),
      expectedDraftId: draftId,
      legacyExecutionProfile: this.legacyExecutionProfile,
      recoverInterrupted: options.recoverInterrupted !== false,
    });
    if (loadPlan.persist) {
      await this.files.write(loadPlan.draft);
    }
    return loadPlan.draft;
  }

  async save(draft: AiTeamBuilderDraft): Promise<void> {
    assertAiTeamBuilderDraftId(draft.draftId);
    await this.files.write(draft);
  }
}
