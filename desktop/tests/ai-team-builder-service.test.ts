import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiTeamBuilder,
  type AiTeamBuilderCodexPort,
  type AiTeamBuilderWriterPort,
} from "../src/ai-team-builder/index.js";

const temporaryRoots: string[] = [];

const proposal = {
  phase: "proposal",
  team: { name: "产品发布团队", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布并收尾",
      responsibilities: ["拆解工作", "复核证据"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "准备发布内容",
      responsibilities: ["提炼叙事", "准备渠道素材"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "分派内容工作。" },
    { speakerSlug: "content-planner", message: "提交内容。" },
    { speakerSlug: "launch-lead", message: "复核并收尾。" },
  ],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AiTeamBuilder service", () => {
  it("moves from the fixed first question through clarifying to a revisioned proposal", async () => {
    const dataRoot = await makeDataRoot();
    const codex = queueCodex([
      success({ phase: "clarifying", question: "主要面向专业用户还是大众用户？" }, "thread-1"),
      success(proposal, "thread-1"),
    ]);
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    await expect(builder.start("onboarding")).resolves.toMatchObject({
      phase: "idle",
      messages: [{ role: "assistant", text: expect.stringContaining("长期替你完成什么工作") }],
      proposal: null,
    });
    await expect(builder.submit("onboarding", "持续负责产品发布")).resolves.toMatchObject({
      phase: "clarifying",
      messages: expect.arrayContaining([
        { role: "user", text: "持续负责产品发布" },
        { role: "assistant", text: "主要面向专业用户还是大众用户？" },
      ]),
    });
    await expect(builder.submit("onboarding", "面向专业用户")).resolves.toMatchObject({
      phase: "proposal",
      proposalRevision: 1,
      proposal: { team: { name: "产品发布团队" } },
      actions: ["adjust", "commit", "cancel"],
    });
    expect(codex.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ externalSessionId: null }),
    );
    expect(codex.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ externalSessionId: "thread-1" }),
    );
  });

  it("locks duplicate input while a turn is running without misclassifying a live poll as interrupted", async () => {
    const dataRoot = await makeDataRoot();
    type CodexResult = Awaited<ReturnType<AiTeamBuilderCodexPort["execute"]>>;
    let resolveCodex!: (value: CodexResult) => void;
    const codex: AiTeamBuilderCodexPort = {
      execute: vi.fn((): Promise<CodexResult> => new Promise<CodexResult>((resolve) => {
        resolveCodex = resolve;
      })),
    };
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    const pending = builder.submit("onboarding", "持续负责产品发布");
    await vi.waitFor(() => {
      expect(codex.execute).toHaveBeenCalledTimes(1);
    });
    await expect(builder.getState("onboarding")).resolves.toMatchObject({ phase: "running" });
    await expect(builder.submit("onboarding", "重复提交")).rejects.toMatchObject({
      code: "AI_TEAM_BUILDER_REQUEST_INVALID",
    });
    resolveCodex(success({ phase: "clarifying", question: "面向谁？" }, "thread-1"));
    await expect(pending).resolves.toMatchObject({ phase: "clarifying" });
  });

  it("executes at most one automatic repair turn and exposes a retryable safe failure", async () => {
    const dataRoot = await makeDataRoot();
    const codex = queueCodex([
      success({ phase: "proposal", members: [] }, "thread-1"),
      success({ phase: "proposal", still: "invalid" }, "thread-1"),
    ]);
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    const state = await builder.submit("draft", "帮我做发布");

    expect(codex.execute).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({
      phase: "failed",
      proposal: null,
      error: {
        code: "invalid-response",
        canRetry: true,
      },
      actions: ["retry", "cancel"],
    });
    expect(JSON.stringify(state)).not.toContain("still");
    expect(JSON.stringify(state)).not.toContain("thread-1");
  });

  it("repairs one invalid response when the repair output is valid", async () => {
    const dataRoot = await makeDataRoot();
    const codex = queueCodex([
      success({ phase: "proposal", members: [] }, "thread-1"),
      success(proposal, "thread-1"),
    ]);
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    await expect(builder.submit("draft", "帮我做发布")).resolves.toMatchObject({
      phase: "proposal",
      proposalRevision: 1,
    });
    expect(codex.execute).toHaveBeenCalledTimes(2);
    expect(codex.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalSessionId: "thread-1",
      prompt: expect.stringContaining("只修复以下问题"),
    }));
  });

  it("fails closed on a lost thread and retries the same external session", async () => {
    const dataRoot = await makeDataRoot();
    const codex = queueCodex([
      success(proposal, "thread-1"),
      {
        ok: false,
        reason: "exit-code-1",
        resumeFailed: true,
        externalSessionId: "thread-1",
      },
      {
        ok: false,
        reason: "exit-code-1",
        resumeFailed: true,
        externalSessionId: "thread-1",
      },
    ]);
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    await expect(builder.submit("draft", "帮我做发布")).resolves.toMatchObject({
      phase: "proposal",
      proposalRevision: 1,
    });
    const failed = await builder.adjust("draft", "再精简一点");

    expect(failed).toMatchObject({
      phase: "failed",
      proposalRevision: 1,
      proposal: { team: { name: proposal.team.name } },
      error: {
        code: "context-lost",
        humanMessage: "AI 上下文暂时无法继续，已保留对话和最后有效方案。",
      },
    });
    await expect(builder.retry("draft")).resolves.toMatchObject({
      phase: "failed",
      error: { code: "context-lost" },
    });
    expect(codex.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ externalSessionId: "thread-1" }),
    );
    expect(codex.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ externalSessionId: "thread-1" }),
    );
  });

  it("persists a newly observed external session before the driver turn settles", async () => {
    const dataRoot = await makeDataRoot();
    const codex: AiTeamBuilderCodexPort = {
      execute: vi.fn(async (input) => {
        await input.onExternalSessionStarted?.("thread-observed-before-crash");
        throw new Error("driver crashed after session creation");
      }),
    };
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      resolveExecutionProfile: codexProfile,
    });

    await expect(builder.submit("draft-observed", "帮我做发布")).resolves.toMatchObject({
      phase: "failed",
      error: {
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，已保留当前内容。",
      },
    });
    const stored = JSON.parse(await fs.readFile(
      path.join(
        dataRoot,
        ".state",
        "ai-team-builder-drafts",
        "draft-observed.json",
      ),
      "utf8",
    )) as { phase?: string; externalSessionId?: string | null };
    expect(stored.phase).toBe("failed");
    expect(stored.externalSessionId).toBe("thread-observed-before-crash");
  });

  it("restores an unconfirmed draft while DTO keys remain an exact safe whitelist", async () => {
    const dataRoot = await makeDataRoot();
    const first = new AiTeamBuilder({
      dataRoot,
      codex: queueCodex([success(proposal, "secret-thread")]),
      resolveExecutionProfile: codexProfile,
    });
    await first.submit("agent-teams", "帮我做发布");

    const restored = await new AiTeamBuilder({ dataRoot }).getState("agent-teams");

    expect(restored).toMatchObject({
      phase: "proposal",
      proposalRevision: 1,
      proposal: { team: { name: "产品发布团队" } },
    });
    expect(Object.keys(restored).sort()).toEqual([
      "actions",
      "builderCli",
      "error",
      "messages",
      "phase",
      "proposal",
      "proposalRevision",
      "selectedTeamId",
    ]);
    const serialized = JSON.stringify(restored);
    for (const forbidden of [
      "threadId",
      "secret-thread",
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

  it("rejects a stale revision and retains the proposal when creation fails", async () => {
    const dataRoot = await makeDataRoot();
    const writer: AiTeamBuilderWriterPort = {
      create: vi.fn(async () => {
        throw new Error(`/private/runtime/secret failed`);
      }),
    };
    const builder = new AiTeamBuilder({
      dataRoot,
      codex: queueCodex([success(proposal, "thread-1")]),
      resolveExecutionProfile: codexProfile,
      writer,
    });
    await builder.submit("draft", "帮我做发布");

    await expect(builder.commit("draft", 0)).rejects.toMatchObject({
      staleCode: "AI_TEAM_BUILDER_STALE_REVISION",
    });
    const failed = await builder.commit("draft", 1);

    expect(failed).toMatchObject({
      phase: "failed",
      proposalRevision: 1,
      proposal: { team: { name: "产品发布团队" } },
      error: { code: "create-failed", canRetry: true },
    });
    expect(JSON.stringify(failed)).not.toContain("/private/runtime/secret");
  });

  it("retries a failed commit without changing proposal revision", async () => {
    const dataRoot = await makeDataRoot();
    const writer: AiTeamBuilderWriterPort = {
      create: vi.fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValueOnce({ teamId: "created-team" }),
    };
    const builder = new AiTeamBuilder({
      dataRoot,
      codex: queueCodex([success(proposal, "thread-1")]),
      resolveExecutionProfile: codexProfile,
      writer,
    });
    await builder.submit("draft", "帮我做发布");
    await builder.commit("draft", 1);

    await expect(builder.retry("draft")).resolves.toMatchObject({
      phase: "selected",
      proposalRevision: 1,
      selectedTeamId: "created-team",
    });
    expect(writer.create).toHaveBeenCalledTimes(2);
  });
});

function queueCodex(
  results: Array<Awaited<ReturnType<AiTeamBuilderCodexPort["execute"]>>>,
): AiTeamBuilderCodexPort & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async () => {
      const result = results.shift();
      if (result === undefined) {
        throw new Error("Unexpected Codex call");
      }
      return result;
    }),
  };
}

function success(value: unknown, externalSessionId: string) {
  return {
    ok: true as const,
    finalText: JSON.stringify(value),
    externalSessionId,
  };
}

async function codexProfile() {
  return { cli: "codex", model: "test-codex", effort: "high" } as const;
}

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-service-"));
  temporaryRoots.push(root);
  return root;
}
