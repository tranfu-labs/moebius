import { randomUUID } from "node:crypto";
import path from "node:path";

import { CODEX_MODEL } from "../../../src/config.js";
import {
  forgetTrashedUserTeamRecord,
  registerUserTeamSnapshot,
} from "../team-record-store.js";
import type { ExecutionCli } from "../team-execution-profile.js";
import {
  AiTeamBuilderService,
  type AiTeamBuilderWriterPort,
} from "./builder-service.js";
import { AiTeamBuilderClaudeSpawner } from "./claude-spawner.js";
import { AiTeamBuilderCodexSpawner } from "./codex-spawner.js";
import type { AiTeamBuilderServicePort } from "./contract.js";
import type { AiTeamBuilderDriverPort } from "./driver.js";
import { AiTeamBuilderDraftFileStore } from "./draft-file-store.js";
import { AiTeamBuilderDraftRepository } from "./draft-repository.js";
import type { AiTeamBuilderState } from "./dto.js";
import {
  resolveAiTeamBuilderExecutionProfile,
  type AiTeamBuilderExecutionProfileResolver,
} from "./execution-profile.js";
import { AiTeamBuilderKimiSpawner } from "./kimi-spawner.js";
import { AiTeamWriteFileStore } from "./team-write-store.js";
import { AiTeamWriter } from "./team-writer.js";
import { AiTeamBuilderTurnRuntime } from "./turn-runtime.js";

export { AiTeamBuilderRequestError } from "./request-error.js";
export type { AiTeamBuilderWriterPort } from "./builder-service.js";

export type AiTeamBuilderCodexPort = AiTeamBuilderDriverPort;

export interface AiTeamBuilderOptions {
  dataRoot: string;
  codex?: AiTeamBuilderDriverPort;
  claude?: AiTeamBuilderDriverPort;
  kimi?: AiTeamBuilderDriverPort;
  resolveExecutionProfile?: AiTeamBuilderExecutionProfileResolver;
  writer?: AiTeamBuilderWriterPort;
}

export class AiTeamBuilder implements AiTeamBuilderServicePort {
  private readonly service: AiTeamBuilderService;

  constructor(options: AiTeamBuilderOptions) {
    const dataRoot = path.resolve(options.dataRoot);
    const drivers: Readonly<Record<ExecutionCli, AiTeamBuilderDriverPort>> = {
      codex: options.codex ?? new AiTeamBuilderCodexSpawner(),
      claude: options.claude ?? new AiTeamBuilderClaudeSpawner(),
      kimi: options.kimi ?? new AiTeamBuilderKimiSpawner(),
    };
    const drafts = new AiTeamBuilderDraftRepository(
      new AiTeamBuilderDraftFileStore(dataRoot),
      { cli: "codex", model: CODEX_MODEL, effort: "high" },
    );
    const writer = options.writer ?? new AiTeamWriter({
      store: new AiTeamWriteFileStore(),
      register: registerUserTeamSnapshot,
      rollbackRecord: forgetTrashedUserTeamRecord,
      createId: randomUUID,
    });
    this.service = new AiTeamBuilderService(
      dataRoot,
      drafts,
      new AiTeamBuilderTurnRuntime(dataRoot, drafts, drivers),
      options.resolveExecutionProfile ?? resolveAiTeamBuilderExecutionProfile,
      writer,
    );
  }

  getState(draftId: string): Promise<AiTeamBuilderState> {
    return this.service.getState(draftId);
  }

  start(draftId: string): Promise<AiTeamBuilderState> {
    return this.service.start(draftId);
  }

  submit(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.service.submit(draftId, text);
  }

  adjust(draftId: string, text: string): Promise<AiTeamBuilderState> {
    return this.service.adjust(draftId, text);
  }

  retry(draftId: string): Promise<AiTeamBuilderState> {
    return this.service.retry(draftId);
  }

  commit(draftId: string, proposalRevision: number): Promise<AiTeamBuilderState> {
    return this.service.commit(draftId, proposalRevision);
  }

  getRunningTaskCount(): number {
    return this.service.getRunningTaskCount();
  }

  cancelAll(): Promise<void> {
    return this.service.cancelAll();
  }
}
