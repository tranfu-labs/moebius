import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_TEAM_BUILDER_IPC_CHANNELS,
  registerAiTeamBuilderIpc,
  type AiTeamBuilderIpcMain,
  type AiTeamBuilderIpcResponse,
} from "../src/ai-team-builder-ipc.js";
import {
  AiTeamBuilder,
  type AiTeamBuilderCodexPort,
} from "../src/ai-team-builder/index.js";

const temporaryRoots: string[] = [];

const proposal = {
  phase: "proposal",
  team: { name: "发布团队", purpose: "持续完成发布" },
  members: [
    {
      slug: "lead",
      name: "负责人",
      role: "统筹并收尾",
      responsibilities: ["拆解", "复核"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["writer"],
    },
    {
      slug: "writer",
      name: "作者",
      role: "准备内容",
      responsibilities: ["写作"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["lead"],
    },
  ],
  primaryAgentSlug: "lead",
  relayBeats: [
    { speakerSlug: "lead", message: "派工" },
    { speakerSlug: "writer", message: "交付" },
  ],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AI team builder IPC outer boundary", () => {
  it("drives the real service through registered handlers and returns only safe DTO fields", async () => {
    const dataRoot = await makeDataRoot();
    const codex: AiTeamBuilderCodexPort = {
      execute: vi.fn(async () => ({
        ok: true as const,
        finalText: JSON.stringify(proposal),
        externalSessionId: "secret-thread-id",
      })),
    };
    const handlers = registerForTest(new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    }));

    const started = await invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.start, {
      draftId: "onboarding",
    });
    expect(started).toMatchObject({ ok: true, state: { phase: "idle" } });

    const submitted = await invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.submit, {
      draftId: "onboarding",
      text: "持续做产品发布",
    });
    expect(submitted).toMatchObject({
      ok: true,
      state: {
        phase: "proposal",
        proposalRevision: 1,
        proposal: { team: { name: "发布团队" } },
      },
    });
    const serialized = JSON.stringify(submitted);
    for (const forbidden of [
      "secret-thread-id",
      "threadId",
      "jsonlPath",
      "schemaPath",
      "cwd",
      "internalReason",
      "stdout",
      "stderr",
      dataRoot,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("sanitizes stale revisions, malformed requests, and unexpected internal errors", async () => {
    const dataRoot = await makeDataRoot();
    const handlers = registerForTest(new AiTeamBuilder({
      dataRoot,
      codex: {
        execute: vi.fn(async () => ({
          ok: true as const,
          finalText: JSON.stringify(proposal),
          externalSessionId: "thread",
        })),
      },
      resolveExecutionProfile: codexProfile,
      writer: {
        create: vi.fn(async () => {
          throw new Error(`${dataRoot}/private-stack`);
        }),
      },
    }));
    await invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.submit, {
      draftId: "draft",
      text: "目标",
    });

    await expect(invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.commit, {
      draftId: "draft",
      proposalRevision: 99,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "stale-revision",
        canRetry: false,
      },
    });
    await expect(invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.submit, {
      draftId: "draft",
      text: "",
      threadId: "injected",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-request", canRetry: false },
    });
    const failedCommit = await invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.commit, {
      draftId: "draft",
      proposalRevision: 1,
    });
    expect(failedCommit).toMatchObject({
      ok: true,
      state: {
        phase: "failed",
        error: { code: "create-failed", canRetry: true },
      },
    });
    expect(JSON.stringify(failedCommit)).not.toContain(dataRoot);
  });

  it("maps builder readiness failures to the existing safe retryable error", async () => {
    const dataRoot = await makeDataRoot();
    const handlers = registerForTest(new AiTeamBuilder({
      dataRoot,
      resolveExecutionProfile: async () => {
        throw new Error(`/private/bin/codex: authentication token expired`);
      },
    }));

    const result = await invoke(handlers, AI_TEAM_BUILDER_IPC_CHANNELS.start, {
      draftId: "cold-start",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "temporarily-unavailable",
        canRetry: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("/private/bin/codex");
    expect(JSON.stringify(result)).not.toContain("authentication");
  });
});

type Handler = (event: unknown, request: unknown) => Promise<AiTeamBuilderIpcResponse>;

function registerForTest(builder: AiTeamBuilder): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const ipcMain: AiTeamBuilderIpcMain = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
  };
  registerAiTeamBuilderIpc({ ipcMain, builder });
  return handlers;
}

async function invoke(
  handlers: Map<string, Handler>,
  channel: string,
  request: unknown,
): Promise<AiTeamBuilderIpcResponse> {
  const handler = handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`Missing handler for ${channel}`);
  }
  return handler({}, request);
}

async function codexProfile() {
  return { cli: "codex", model: "test-codex", effort: "high" } as const;
}

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-ipc-"));
  temporaryRoots.push(root);
  return root;
}
