import type { AiTeamBuilderExecutionProfileResolver } from "./execution-profile.js";
import {
  planAiTeamBuilderAdjustment,
  planAiTeamBuilderExecutionProfile,
  planAiTeamBuilderMutationAvailability,
  planAiTeamBuilderRetry,
  planAiTeamBuilderSubmit,
} from "./builder-action-plan.js";
import { formatAiTeamBuilderError } from "./draft-persistence-plan.js";
import type { AiTeamBuilderDraftRepositoryPort } from "./draft-store-contract.js";
import { toAiTeamBuilderState, type AiTeamBuilderState } from "./dto.js";
import { AiTeamBuilderRequestError } from "./request-error.js";
import {
  assignAiTeamBuilderExecutionProfile,
  beginAiTeamBuilderCommit,
  beginAiTeamBuilderTurn,
  failAiTeamBuilderDraft,
  selectAiTeamBuilderTeam,
  type AiTeamBuilderDraft,
} from "./state-machine.js";
import type { AiTeamBuilderTurnRuntime } from "./turn-runtime.js";
import type { AiTeamBuilderProposal } from "./validator.js";

export interface AiTeamBuilderWriterPort {
  create(dataRoot: string, proposal: AiTeamBuilderProposal): Promise<{ teamId: string }>;
}

export class AiTeamBuilderService {
  private readonly mutations = new Map<string, Promise<AiTeamBuilderState>>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly dataRoot: string,
    private readonly drafts: AiTeamBuilderDraftRepositoryPort,
    private readonly turnRuntime: AiTeamBuilderTurnRuntime,
    private readonly resolveExecutionProfile: AiTeamBuilderExecutionProfileResolver,
    private readonly writer: AiTeamBuilderWriterPort,
  ) {}

  async getState(draftId: string): Promise<AiTeamBuilderState> {
    return toAiTeamBuilderState(await this.drafts.load(draftId, {
      recoverInterrupted: !this.mutations.has(draftId),
    }));
  }

  getRunningTaskCount(): number {
    return this.mutations.size;
  }

  async cancelAll(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    await Promise.all([...this.mutations.values()].map((pending) => pending.catch(() => undefined)));
  }

  async start(draftId: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () =>
      toAiTeamBuilderState(await this.ensureExecutionProfile(await this.drafts.load(draftId))));
  }

  async submit(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async (signal) => {
      const current = await this.ensureExecutionProfile(await this.drafts.load(draftId));
      const submitPlan = planAiTeamBuilderSubmit(current);
      if (submitPlan.kind === "reject") {
        throw new AiTeamBuilderRequestError(submitPlan.message);
      }
      const running = beginAiTeamBuilderTurn(current, text, { appendUserMessage: true });
      await this.drafts.save(running);
      return this.turnRuntime.run(running, signal);
    });
  }

  async adjust(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async (signal) => {
      const current = await this.drafts.load(draftId);
      const adjustmentPlan = planAiTeamBuilderAdjustment(current);
      if (adjustmentPlan.kind === "reject") {
        throw new AiTeamBuilderRequestError(adjustmentPlan.message);
      }
      const running = beginAiTeamBuilderTurn(current, text, { appendUserMessage: true });
      await this.drafts.save(running);
      return this.turnRuntime.run(running, signal);
    });
  }

  async retry(draftId: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async (signal) => {
      const current = await this.drafts.load(draftId);
      const retryPlan = planAiTeamBuilderRetry(current);
      if (retryPlan.kind === "reject") {
        throw new AiTeamBuilderRequestError(retryPlan.message);
      }
      if (retryPlan.kind === "commit") {
        return this.commitCurrentDraft(current, retryPlan.proposalRevision);
      }
      const running = beginAiTeamBuilderTurn(current, retryPlan.prompt, {
        appendUserMessage: false,
      });
      await this.drafts.save(running);
      return this.turnRuntime.run(running, signal);
    });
  }

  async commit(draftId: string, proposalRevision: number): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () =>
      this.commitCurrentDraft(await this.drafts.load(draftId), proposalRevision));
  }

  private async commitCurrentDraft(
    current: AiTeamBuilderDraft,
    proposalRevision: number,
  ): Promise<AiTeamBuilderState> {
    const committing = beginAiTeamBuilderCommit(current, proposalRevision);
    await this.drafts.save(committing);
    try {
      const result = await this.writer.create(this.dataRoot, committing.proposal!);
      const selected = selectAiTeamBuilderTeam(committing, result.teamId);
      await this.drafts.save(selected);
      return toAiTeamBuilderState(selected);
    } catch (error) {
      const failed = failAiTeamBuilderDraft(
        committing,
        { kind: "commit-failed", internalReason: formatAiTeamBuilderError(error) },
        "commit",
      );
      await this.drafts.save(failed);
      return toAiTeamBuilderState(failed);
    }
  }

  private async ensureExecutionProfile(draft: AiTeamBuilderDraft): Promise<AiTeamBuilderDraft> {
    const profilePlan = planAiTeamBuilderExecutionProfile(draft);
    if (profilePlan === "keep") {
      return draft;
    }
    const assigned = assignAiTeamBuilderExecutionProfile(
      draft,
      await this.resolveExecutionProfile(),
    );
    await this.drafts.save(assigned);
    return assigned;
  }

  private async mutate(
    draftId: string,
    operation: (signal: AbortSignal) => Promise<AiTeamBuilderState>,
  ): Promise<AiTeamBuilderState> {
    const mutationPlan = planAiTeamBuilderMutationAvailability(this.mutations.has(draftId));
    if (mutationPlan.kind === "reject") {
      throw new AiTeamBuilderRequestError(mutationPlan.message);
    }
    const controller = new AbortController();
    const pending = operation(controller.signal);
    this.mutations.set(draftId, pending);
    this.abortControllers.set(draftId, controller);
    try {
      return await pending;
    } finally {
      this.mutations.delete(draftId);
      this.abortControllers.delete(draftId);
    }
  }
}
