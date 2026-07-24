import {
  AiTeamBuilder,
  AiTeamBuilderRequestError,
} from "./ai-team-builder/index.js";
import {
  AI_TEAM_BUILDER_IPC_CHANNELS,
  type AiTeamBuilderCommitRequest,
  type AiTeamBuilderDraftRequest,
  type AiTeamBuilderIpcResponse,
  type AiTeamBuilderTurnRequest,
} from "./ai-team-builder/contract.js";
import { AiTeamBuilderStaleRevisionError } from "./ai-team-builder/state-machine.js";
import type { AiTeamBuilderState } from "./ai-team-builder/dto.js";

export * from "./ai-team-builder/contract.js";

export interface AiTeamBuilderIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<AiTeamBuilderIpcResponse>,
  ): void;
}

export function registerAiTeamBuilderIpc(input: {
  ipcMain: AiTeamBuilderIpcMain;
  builder: AiTeamBuilder;
}): void {
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.state, async (_event, rawRequest) =>
    invokeSafely(async () => input.builder.getState(parseDraftRequest(rawRequest).draftId)));
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.start, async (_event, rawRequest) =>
    invokeSafely(async () => input.builder.start(parseDraftRequest(rawRequest).draftId)));
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.submit, async (_event, rawRequest) =>
    invokeSafely(async () => {
      const request = parseTurnRequest(rawRequest);
      return input.builder.submit(request.draftId, request.text);
    }));
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.adjust, async (_event, rawRequest) =>
    invokeSafely(async () => {
      const request = parseTurnRequest(rawRequest);
      return input.builder.adjust(request.draftId, request.text);
    }));
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.retry, async (_event, rawRequest) =>
    invokeSafely(async () => input.builder.retry(parseDraftRequest(rawRequest).draftId)));
  input.ipcMain.handle(AI_TEAM_BUILDER_IPC_CHANNELS.commit, async (_event, rawRequest) =>
    invokeSafely(async () => {
      const request = parseCommitRequest(rawRequest);
      return input.builder.commit(request.draftId, request.proposalRevision);
    }));
}

async function invokeSafely(operation: () => Promise<AiTeamBuilderState>): Promise<AiTeamBuilderIpcResponse> {
  try {
    return { ok: true, state: await operation() };
  } catch (error) {
    if (error instanceof AiTeamBuilderStaleRevisionError) {
      return {
        ok: false,
        error: {
          code: "stale-revision",
          humanMessage: "这版团队方案已经更新，请确认当前显示的方案后再创建。",
          canRetry: false,
        },
      };
    }
    if (error instanceof AiTeamBuilderIpcRequestError || error instanceof AiTeamBuilderRequestError) {
      return {
        ok: false,
        error: {
          code: "invalid-request",
          humanMessage: "AI 建队请求无效，请刷新后重试。",
          canRetry: false,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      },
    };
  }
}

function parseDraftRequest(value: unknown): AiTeamBuilderDraftRequest {
  if (!isPlainObject(value)
    || Object.keys(value).length !== 1
    || typeof value.draftId !== "string"
    || value.draftId.trim().length === 0) {
    throw new AiTeamBuilderIpcRequestError();
  }
  return { draftId: value.draftId };
}

function parseTurnRequest(value: unknown): AiTeamBuilderTurnRequest {
  if (!isPlainObject(value)
    || Object.keys(value).some((key) => key !== "draftId" && key !== "text")
    || Object.keys(value).length !== 2
    || typeof value.draftId !== "string"
    || value.draftId.trim().length === 0
    || typeof value.text !== "string"
    || value.text.trim().length === 0) {
    throw new AiTeamBuilderIpcRequestError();
  }
  return { draftId: value.draftId, text: value.text };
}

function parseCommitRequest(value: unknown): AiTeamBuilderCommitRequest {
  if (!isPlainObject(value)
    || Object.keys(value).some((key) => key !== "draftId" && key !== "proposalRevision")
    || Object.keys(value).length !== 2
    || typeof value.draftId !== "string"
    || value.draftId.trim().length === 0
    || typeof value.proposalRevision !== "number"
    || !Number.isSafeInteger(value.proposalRevision)
    || value.proposalRevision < 1) {
    throw new AiTeamBuilderIpcRequestError();
  }
  return { draftId: value.draftId, proposalRevision: value.proposalRevision };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AiTeamBuilderIpcRequestError extends Error {
  readonly code = "AI_TEAM_BUILDER_IPC_REQUEST_INVALID";

  constructor() {
    super("Invalid AI team builder IPC request.");
    this.name = "AiTeamBuilderIpcRequestError";
  }
}
