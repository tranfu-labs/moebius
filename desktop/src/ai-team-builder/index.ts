import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_MODEL } from "../../../src/config.js";
import { isValidPathSegment } from "../team-model.js";
import {
  normalizeExecutionProfile,
  type ExecutionCli,
  type ExecutionProfile,
} from "../team-execution-profile.js";
import { AiTeamBuilderCodexSpawner } from "./codex-spawner.js";
import { AiTeamBuilderClaudeSpawner } from "./claude-spawner.js";
import type { AiTeamBuilderDriverPort } from "./driver.js";
import { toAiTeamBuilderState, type AiTeamBuilderState } from "./dto.js";
import {
  resolveAiTeamBuilderExecutionProfile,
  type AiTeamBuilderExecutionProfileResolver,
} from "./execution-profile.js";
import { AiTeamBuilderKimiSpawner } from "./kimi-spawner.js";
import {
  acceptAiTeamBuilderClarifying,
  acceptAiTeamBuilderProposal,
  beginAiTeamBuilderCommit,
  beginAiTeamBuilderTurn,
  createAiTeamBuilderDraft,
  assignAiTeamBuilderExecutionProfile,
  failAiTeamBuilderDraft,
  recoverInterruptedAiTeamBuilderDraft,
  selectAiTeamBuilderTeam,
  type AiTeamBuilderDraft,
  type AiTeamBuilderInternalError,
} from "./state-machine.js";
import { AiTeamWriter } from "./team-writer.js";
import {
  formatAiTeamBuilderValidationIssues,
  parseAndValidateAiTeamBuilderOutput,
  type AiTeamBuilderProposal,
} from "./validator.js";

export type AiTeamBuilderCodexPort = AiTeamBuilderDriverPort;

export interface AiTeamBuilderWriterPort {
  create(dataRoot: string, proposal: AiTeamBuilderProposal): Promise<{ teamId: string }>;
}

export interface AiTeamBuilderOptions {
  dataRoot: string;
  codex?: AiTeamBuilderDriverPort;
  claude?: AiTeamBuilderDriverPort;
  kimi?: AiTeamBuilderDriverPort;
  resolveExecutionProfile?: AiTeamBuilderExecutionProfileResolver;
  writer?: AiTeamBuilderWriterPort;
}

export class AiTeamBuilder {
  private readonly dataRoot: string;
  private readonly drivers: Readonly<Record<ExecutionCli, AiTeamBuilderDriverPort>>;
  private readonly resolveExecutionProfile: AiTeamBuilderExecutionProfileResolver;
  private readonly writer: AiTeamBuilderWriterPort;
  private readonly mutations = new Map<string, Promise<AiTeamBuilderState>>();

  constructor(options: AiTeamBuilderOptions) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.drivers = {
      codex: options.codex ?? new AiTeamBuilderCodexSpawner(),
      claude: options.claude ?? new AiTeamBuilderClaudeSpawner(),
      kimi: options.kimi ?? new AiTeamBuilderKimiSpawner(),
    };
    this.resolveExecutionProfile =
      options.resolveExecutionProfile ?? resolveAiTeamBuilderExecutionProfile;
    this.writer = options.writer ?? new AiTeamWriter();
  }

  async getState(draftId: string): Promise<AiTeamBuilderState> {
    return toAiTeamBuilderState(await this.loadDraft(draftId, {
      recoverInterrupted: !this.mutations.has(draftId),
    }));
  }

  async start(draftId: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () =>
      toAiTeamBuilderState(await this.ensureExecutionProfile(await this.loadDraft(draftId))));
  }

  async submit(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () => {
      const current = await this.ensureExecutionProfile(await this.loadDraft(draftId));
      if (current.phase !== "idle" && current.phase !== "clarifying") {
        throw new AiTeamBuilderRequestError(`Cannot submit input while ${current.phase}.`);
      }
      const running = beginAiTeamBuilderTurn(current, text, { appendUserMessage: true });
      await this.saveDraft(running);
      return this.runCurrentTurn(running);
    });
  }

  async adjust(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () => {
      const current = await this.loadDraft(draftId);
      if (current.phase !== "proposal") {
        throw new AiTeamBuilderRequestError("A proposal can only be adjusted while it is current.");
      }
      const running = beginAiTeamBuilderTurn(current, text, { appendUserMessage: true });
      await this.saveDraft(running);
      return this.runCurrentTurn(running);
    });
  }

  async retry(draftId: string): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () => {
      const current = await this.loadDraft(draftId);
      if (current.phase !== "failed") {
        throw new AiTeamBuilderRequestError("Only a failed AI team builder draft can be retried.");
      }
      if (current.failedFrom === "commit") {
        if (current.proposal === null || current.proposalRevision === null) {
          throw new AiTeamBuilderRequestError("The failed draft has no proposal to create.");
        }
        return this.commitCurrentDraft(current, current.proposalRevision);
      }
      if (current.pendingPrompt === null) {
        throw new AiTeamBuilderRequestError("The failed draft has no turn to retry.");
      }
      const running = beginAiTeamBuilderTurn(current, current.pendingPrompt, { appendUserMessage: false });
      await this.saveDraft(running);
      return this.runCurrentTurn(running);
    });
  }

  async commit(draftId: string, proposalRevision: number): Promise<AiTeamBuilderState> {
    return this.mutate(draftId, async () =>
      this.commitCurrentDraft(await this.loadDraft(draftId), proposalRevision));
  }

  private async commitCurrentDraft(
    current: AiTeamBuilderDraft,
    proposalRevision: number,
  ): Promise<AiTeamBuilderState> {
    const committing = beginAiTeamBuilderCommit(current, proposalRevision);
    await this.saveDraft(committing);
    try {
      const result = await this.writer.create(this.dataRoot, committing.proposal!);
      const selected = selectAiTeamBuilderTeam(committing, result.teamId);
      await this.saveDraft(selected);
      return toAiTeamBuilderState(selected);
    } catch (error) {
      const failed = failAiTeamBuilderDraft(
        committing,
        { kind: "commit-failed", internalReason: formatError(error) },
        "commit",
      );
      await this.saveDraft(failed);
      return toAiTeamBuilderState(failed);
    }
  }

  private async runCurrentTurn(initial: AiTeamBuilderDraft): Promise<AiTeamBuilderState> {
    const expectedTurnRevision = initial.turnRevision;
    let running = initial;
    const profile = requireExecutionProfile(running);
    const driver = this.drivers[profile.cli];
    const wasResume = running.externalSessionId !== null;
    let result: Awaited<ReturnType<AiTeamBuilderDriverPort["execute"]>>;
    try {
      result = await driver.execute({
        dataRoot: this.dataRoot,
        draftId: running.draftId,
        prompt: running.pendingPrompt!,
        profile,
        externalSessionId: running.externalSessionId,
        onExternalSessionStarted: async (externalSessionId) => {
          running = await this.persistObservedExternalSessionId(
            running,
            externalSessionId,
          );
        },
      });
    } catch (error) {
      return this.finishFailedTurn(
        running,
        {
          kind: wasResume ? "resume-failed" : "engine-failed",
          internalReason: formatError(error),
        },
      );
    }

    if (!result.ok) {
      running = await this.persistObservedExternalSessionId(
        running,
        result.externalSessionId,
      );
      return this.finishFailedTurn(
        running,
        {
          kind: result.resumeFailed ? "resume-failed" : "engine-failed",
          internalReason: result.reason,
        },
      );
    }

    running = await this.persistObservedExternalSessionId(
      running,
      result.externalSessionId,
    );
    let externalSessionId = result.externalSessionId;
    let validation = parseAndValidateAiTeamBuilderOutput(result.finalText);
    if (!validation.ok) {
      let repairResult: Awaited<ReturnType<AiTeamBuilderDriverPort["execute"]>>;
      try {
        repairResult = await driver.execute({
          dataRoot: this.dataRoot,
          draftId: running.draftId,
          prompt: buildRepairPrompt(validation.issues),
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
          {
            kind: "resume-failed",
            internalReason: formatError(error),
          },
        );
      }
      if (!repairResult.ok) {
        running = await this.persistObservedExternalSessionId(
          running,
          repairResult.externalSessionId,
        );
        return this.finishFailedTurn(
          running,
          {
            kind: repairResult.resumeFailed ? "resume-failed" : "engine-failed",
            internalReason: repairResult.reason,
          },
        );
      }
      running = await this.persistObservedExternalSessionId(
        running,
        repairResult.externalSessionId,
      );
      externalSessionId = repairResult.externalSessionId;
      validation = parseAndValidateAiTeamBuilderOutput(repairResult.finalText);
      if (!validation.ok) {
        return this.finishFailedTurn(
          running,
          {
            kind: "invalid-output",
            internalReason: formatAiTeamBuilderValidationIssues(validation.issues),
          },
        );
      }
    }

    const latest = await this.loadDraft(running.draftId, { recoverInterrupted: false });
    if (latest.phase !== "running" || latest.turnRevision !== expectedTurnRevision) {
      return toAiTeamBuilderState(latest);
    }
    const completed = validation.value.phase === "clarifying"
      ? acceptAiTeamBuilderClarifying(latest, validation.value.question, externalSessionId)
      : acceptAiTeamBuilderProposal(latest, validation.value, externalSessionId);
    await this.saveDraft(completed);
    return toAiTeamBuilderState(completed);
  }

  private async finishFailedTurn(
    running: AiTeamBuilderDraft,
    error: AiTeamBuilderInternalError,
  ): Promise<AiTeamBuilderState> {
    const failed = failAiTeamBuilderDraft(running, error, "turn");
    await this.saveDraft(failed);
    return toAiTeamBuilderState(failed);
  }

  private async persistObservedExternalSessionId(
    draft: AiTeamBuilderDraft,
    observedExternalSessionId: string | null,
  ): Promise<AiTeamBuilderDraft> {
    if (observedExternalSessionId === null) return draft;
    if (
      draft.externalSessionId !== null
      && draft.externalSessionId !== observedExternalSessionId
    ) {
      throw new AiTeamBuilderRequestError(
        "AI team builder provider returned a conflicting session id.",
      );
    }
    if (draft.externalSessionId === observedExternalSessionId) return draft;
    const linked = { ...draft, externalSessionId: observedExternalSessionId };
    await this.saveDraft(linked);
    return linked;
  }

  private async mutate(
    draftId: string,
    operation: () => Promise<AiTeamBuilderState>,
  ): Promise<AiTeamBuilderState> {
    assertDraftId(draftId);
    if (this.mutations.has(draftId)) {
      throw new AiTeamBuilderRequestError("An AI team builder operation is already running.");
    }
    const pending = operation();
    this.mutations.set(draftId, pending);
    try {
      return await pending;
    } finally {
      this.mutations.delete(draftId);
    }
  }

  private async loadDraft(
    draftId: string,
    options: { recoverInterrupted?: boolean } = {},
  ): Promise<AiTeamBuilderDraft> {
    assertDraftId(draftId);
    const draftPath = this.getDraftPath(draftId);
    let draft: AiTeamBuilderDraft;
    try {
      const parsed = parseStoredDraft(await fs.readFile(draftPath, "utf8"), draftId);
      draft = parsed.draft;
      if (parsed.migrated) {
        await this.saveDraft(draft);
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      draft = createAiTeamBuilderDraft(draftId);
      await this.saveDraft(draft);
      return draft;
    }
    if (options.recoverInterrupted === false) {
      return draft;
    }
    const recovered = recoverInterruptedAiTeamBuilderDraft(draft);
    if (recovered !== draft) {
      await this.saveDraft(recovered);
    }
    return recovered;
  }

  private async ensureExecutionProfile(draft: AiTeamBuilderDraft): Promise<AiTeamBuilderDraft> {
    if (draft.executionProfile !== null) {
      return draft;
    }
    const assigned = assignAiTeamBuilderExecutionProfile(
      draft,
      await this.resolveExecutionProfile(),
    );
    await this.saveDraft(assigned);
    return assigned;
  }

  private async saveDraft(draft: AiTeamBuilderDraft): Promise<void> {
    const draftPath = this.getDraftPath(draft.draftId);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    const temporaryPath = `${draftPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, draftPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private getDraftPath(draftId: string): string {
    return path.join(this.dataRoot, ".state", "ai-team-builder-drafts", `${draftId}.json`);
  }
}

function buildRepairPrompt(
  issues: readonly { path: string; message: string }[],
): string {
  return `上一条输出未通过校验。只修复以下问题并重新返回完整 schema JSON，不要解释：\n${issues
    .map((issue) => `- ${issue.path}: ${issue.message}`)
    .join("\n")}`;
}

function parseStoredDraft(
  source: string,
  expectedDraftId: string,
): { draft: AiTeamBuilderDraft; migrated: boolean } {
  const value: unknown = JSON.parse(source);
  if (!isPlainObject(value)
    || value.draftId !== expectedDraftId
    || typeof value.phase !== "string"
    || !Array.isArray(value.messages)) {
    throw new AiTeamBuilderRequestError("Stored AI team builder draft is invalid.");
  }
  if (value.version === 1) {
    const { threadId: legacyThreadId, ...legacyDraft } = value;
    const legacyError = isPlainObject(value.error) && value.error.kind === "codex-failed"
      ? { ...value.error, kind: "engine-failed" }
      : value.error;
    return {
      migrated: true,
      draft: {
        ...legacyDraft,
        version: 3,
        executionProfile: {
          cli: "codex",
          model: CODEX_MODEL,
          effort: "high",
        },
        externalSessionId: typeof legacyThreadId === "string" ? legacyThreadId : null,
        error: legacyError,
      } as unknown as AiTeamBuilderDraft,
    };
  }
  if (value.version === 2) {
    const { threadRebuildUsed: _legacyThreadRebuildUsed, ...legacyDraft } = value;
    const executionProfile = value.executionProfile === null
      ? null
      : normalizeExecutionProfile(value.executionProfile);
    return {
      migrated: true,
      draft: {
        ...legacyDraft,
        version: 3,
        executionProfile,
        externalSessionId: typeof value.externalSessionId === "string"
          ? value.externalSessionId
          : null,
      } as unknown as AiTeamBuilderDraft,
    };
  }
  if (value.version !== 3) {
    throw new AiTeamBuilderRequestError("Stored AI team builder draft version is unsupported.");
  }
  const executionProfile = value.executionProfile === null
    ? null
    : normalizeExecutionProfile(value.executionProfile);
  return {
    migrated: false,
    draft: {
      ...value,
      executionProfile,
      externalSessionId: typeof value.externalSessionId === "string"
        ? value.externalSessionId
        : null,
    } as unknown as AiTeamBuilderDraft,
  };
}

function requireExecutionProfile(draft: AiTeamBuilderDraft): ExecutionProfile {
  if (draft.executionProfile === null) {
    throw new AiTeamBuilderRequestError("AI team builder execution profile is not assigned.");
  }
  return draft.executionProfile;
}

function assertDraftId(draftId: string): void {
  if (!isValidPathSegment(draftId) || draftId.trim() !== draftId) {
    throw new AiTeamBuilderRequestError("Invalid AI team builder draft id.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AiTeamBuilderRequestError extends Error {
  readonly code = "AI_TEAM_BUILDER_REQUEST_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderRequestError";
  }
}
