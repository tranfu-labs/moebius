import type { ExecutionCli } from "../team-execution-profile.js";
import type { AiTeamBuilderDriverPort } from "./driver.js";
import {
  requireAiTeamBuilderExecutionProfile,
} from "./draft-persistence-plan.js";
import type { AiTeamBuilderDraftRepositoryPort } from "./draft-store-contract.js";
import { toAiTeamBuilderState, type AiTeamBuilderState } from "./dto.js";
import {
  failAiTeamBuilderDraft,
  type AiTeamBuilderDraft,
  type AiTeamBuilderInternalError,
} from "./state-machine.js";
import {
  planAiTeamBuilderAcceptedDraft,
  planAiTeamBuilderDriverResult,
  planAiTeamBuilderExternalSessionLink,
  planAiTeamBuilderOutput,
  planAiTeamBuilderRepairPrompt,
  planAiTeamBuilderThrownDriverError,
  planAiTeamBuilderTurnCommit,
} from "./turn-plan.js";
import { parseAndValidateAiTeamBuilderOutput } from "./validator.js";

export class AiTeamBuilderTurnRuntime {
  constructor(
    private readonly dataRoot: string,
    private readonly drafts: AiTeamBuilderDraftRepositoryPort,
    private readonly drivers: Readonly<Record<ExecutionCli, AiTeamBuilderDriverPort>>,
  ) {}

  async run(initial: AiTeamBuilderDraft): Promise<AiTeamBuilderState> {
    const expectedTurnRevision = initial.turnRevision;
    let running = initial;
    const profile = requireAiTeamBuilderExecutionProfile(running);
    const driver = this.drivers[profile.cli];
    const wasResume = running.externalSessionId !== null;
    let rawResult: Awaited<ReturnType<AiTeamBuilderDriverPort["execute"]>>;
    try {
      rawResult = await driver.execute({
        dataRoot: this.dataRoot,
        draftId: running.draftId,
        prompt: running.pendingPrompt!,
        profile,
        externalSessionId: running.externalSessionId,
        onExternalSessionStarted: async (externalSessionId) => {
          running = await this.persistObservedExternalSessionId(running, externalSessionId);
        },
      });
    } catch (error) {
      return this.finishFailedTurn(
        running,
        planAiTeamBuilderThrownDriverError(wasResume, error),
      );
    }

    const driverDecision = planAiTeamBuilderDriverResult(rawResult);
    if (driverDecision.kind === "failure") {
      running = await this.persistObservedExternalSessionId(
        running,
        driverDecision.externalSessionId,
      );
      return this.finishFailedTurn(running, driverDecision.error);
    }

    running = await this.persistObservedExternalSessionId(
      running,
      driverDecision.externalSessionId,
    );
    let externalSessionId = driverDecision.externalSessionId;
    let outputDecision = planAiTeamBuilderOutput(
      parseAndValidateAiTeamBuilderOutput(driverDecision.finalText),
      false,
    );
    if (outputDecision.kind === "repair") {
      let rawRepairResult: Awaited<ReturnType<AiTeamBuilderDriverPort["execute"]>>;
      try {
        rawRepairResult = await driver.execute({
          dataRoot: this.dataRoot,
          draftId: running.draftId,
          prompt: planAiTeamBuilderRepairPrompt(outputDecision.issues),
          profile,
          externalSessionId,
          onExternalSessionStarted: async (observedExternalSessionId) => {
            running = await this.persistObservedExternalSessionId(
              running,
              observedExternalSessionId,
            );
          },
        });
      } catch (error) {
        return this.finishFailedTurn(
          running,
          planAiTeamBuilderThrownDriverError(true, error),
        );
      }
      const repairDecision = planAiTeamBuilderDriverResult(rawRepairResult);
      if (repairDecision.kind === "failure") {
        running = await this.persistObservedExternalSessionId(
          running,
          repairDecision.externalSessionId,
        );
        return this.finishFailedTurn(running, repairDecision.error);
      }
      running = await this.persistObservedExternalSessionId(
        running,
        repairDecision.externalSessionId,
      );
      externalSessionId = repairDecision.externalSessionId;
      outputDecision = planAiTeamBuilderOutput(
        parseAndValidateAiTeamBuilderOutput(repairDecision.finalText),
        true,
      );
    }

    if (outputDecision.kind === "failure") {
      return this.finishFailedTurn(running, outputDecision.error);
    }
    if (outputDecision.kind === "repair") {
      throw new Error("AI team builder repair plan did not converge.");
    }
    const latest = await this.drafts.load(running.draftId, { recoverInterrupted: false });
    const commitPlan = planAiTeamBuilderTurnCommit(latest, expectedTurnRevision);
    if (commitPlan === "skip") {
      return toAiTeamBuilderState(latest);
    }
    const completed = planAiTeamBuilderAcceptedDraft({
      draft: latest,
      output: outputDecision.value,
      externalSessionId,
    });
    await this.drafts.save(completed);
    return toAiTeamBuilderState(completed);
  }

  private async finishFailedTurn(
    running: AiTeamBuilderDraft,
    error: AiTeamBuilderInternalError,
  ): Promise<AiTeamBuilderState> {
    const failed = failAiTeamBuilderDraft(running, error, "turn");
    await this.drafts.save(failed);
    return toAiTeamBuilderState(failed);
  }

  private async persistObservedExternalSessionId(
    draft: AiTeamBuilderDraft,
    observedExternalSessionId: string | null,
  ): Promise<AiTeamBuilderDraft> {
    const linkPlan = planAiTeamBuilderExternalSessionLink(draft, observedExternalSessionId);
    if (linkPlan.persist) {
      await this.drafts.save(linkPlan.draft);
    }
    return linkPlan.draft;
  }

}
