import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiTeamBuilder,
  type AiTeamBuilderCodexPort,
} from "../src/ai-team-builder/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AI team builder engine freeze", () => {
  it("uses Kimi only, with one frozen profile and external session across turns", async () => {
    const dataRoot = await makeDataRoot();
    const codex = driver([]);
    const kimi = driver([
      success({ phase: "clarifying", question: "主要面向谁？" }, "kimi-session"),
      success(proposal(), "kimi-session"),
    ]);
    const profile = { cli: "kimi", model: "kimi-for-coding", effort: "high" } as const;
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      kimi,
      resolveExecutionProfile: vi.fn(async () => profile),
    });

    await expect(builder.start("draft")).resolves.toMatchObject({
      builderCli: "kimi",
      phase: "idle",
    });
    await expect(builder.submit("draft", "持续做发布")).resolves.toMatchObject({
      builderCli: "kimi",
      phase: "clarifying",
    });
    await expect(builder.submit("draft", "面向开发者")).resolves.toMatchObject({
      builderCli: "kimi",
      phase: "proposal",
    });

    expect(codex.execute).not.toHaveBeenCalled();
    expect(kimi.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      profile,
      externalSessionId: null,
    }));
    expect(kimi.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile,
      externalSessionId: "kimi-session",
    }));
  });

  it("does not cross-fallback to Codex when the frozen Kimi driver fails", async () => {
    const dataRoot = await makeDataRoot();
    const codex = driver([]);
    const kimi = driver([{
      ok: false,
      reason: "kimi-unavailable",
      resumeFailed: false,
      externalSessionId: null,
    }]);
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      kimi,
      resolveExecutionProfile: async () => ({
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
    });

    await expect(builder.submit("draft", "持续做发布")).resolves.toMatchObject({
      builderCli: "kimi",
      phase: "failed",
      error: { code: "temporarily-unavailable" },
    });
    expect(kimi.execute).toHaveBeenCalledTimes(1);
    expect(codex.execute).not.toHaveBeenCalled();
  });

  it("migrates v1 drafts to a frozen Codex profile without probing or switching engines", async () => {
    const dataRoot = await makeDataRoot();
    const draftDirectory = path.join(dataRoot, ".state", "ai-team-builder-drafts");
    await fs.mkdir(draftDirectory, { recursive: true });
    await fs.writeFile(path.join(draftDirectory, "legacy.json"), JSON.stringify({
      version: 1,
      draftId: "legacy",
      phase: "clarifying",
      messages: [
        { role: "assistant", text: "问题" },
        { role: "user", text: "旧目标" },
        { role: "assistant", text: "请补充" },
      ],
      proposal: null,
      proposalRevision: null,
      threadId: "legacy-codex-thread",
      turnRevision: 1,
      pendingPrompt: null,
      threadRebuildUsed: false,
      error: null,
      failedFrom: null,
      selectedTeamId: null,
    }), "utf8");
    const codex = driver([success(proposal(), "legacy-codex-thread")]);
    const kimi = driver([]);
    const resolver = vi.fn(async () => {
      throw new Error("legacy draft must not probe");
    });
    const builder = new AiTeamBuilder({
      dataRoot,
      codex,
      kimi,
      resolveExecutionProfile: resolver,
    });

    await expect(builder.submit("legacy", "继续")).resolves.toMatchObject({
      builderCli: "codex",
      phase: "proposal",
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(kimi.execute).not.toHaveBeenCalled();
    expect(codex.execute).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ cli: "codex" }),
      externalSessionId: "legacy-codex-thread",
    }));
    const stored = JSON.parse(
      await fs.readFile(path.join(draftDirectory, "legacy.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      version: 3,
      executionProfile: { cli: "codex" },
      externalSessionId: "legacy-codex-thread",
    });
    expect(stored).not.toHaveProperty("threadId");
  });
});

function driver(
  results: Array<Awaited<ReturnType<AiTeamBuilderCodexPort["execute"]>>>,
): AiTeamBuilderCodexPort & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async () => {
      const result = results.shift();
      if (result === undefined) throw new Error("Unexpected driver call");
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

function proposal() {
  return {
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
}

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-engine-"));
  temporaryRoots.push(root);
  return root;
}
