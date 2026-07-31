import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CEO_CORRECTED_METADATA,
  formatCeoComment,
  formatExternalCommentRoute,
  parseExternalCommentRouteOutput,
  parseCeoOutput,
  type FormatCeoInput,
  type FormatExternalCommentRouteInput,
} from "../src/format-ceo.js";
import { parseAgentMentions } from "../src/conversation.js";

const PLAN_REVIEW_TEMPLATE_ITEMS = [
  "本轮方案已输出",
  "「验收语句」清单",
  "请按你的测试设计流程审查并给出结论",
];

const CODE_VERIFIED_RETRO_TEMPLATE_ITEMS = [
  "dev 已输出",
  "请按已确认「验收语句」逐条验收实现证据",
  "任一不通过时指出未过语句、实际观察与期望差异",
];

describe("parseCeoOutput", () => {
  it("parses no_change JSON", () => {
    expect(parseCeoOutput('{"action":"no_change"}')).toEqual({ kind: "no_change" });
  });

  it("parses no_change JSON wrapped in fenced code block", () => {
    expect(parseCeoOutput('```json\n{"action":"no_change"}\n```')).toEqual({ kind: "no_change" });
  });

  it("parses replace JSON with body", () => {
    expect(parseCeoOutput('{"action":"replace","body":"hello"}')).toEqual({ kind: "replace", body: "hello" });
  });

  it("parses append JSON with as and body", () => {
    expect(parseCeoOutput('{"action":"append","as":"ceo","body":"hi"}')).toEqual({
      kind: "append",
      as: "ceo",
      body: "hi",
    });
  });

  it("returns invalid_json for non-JSON output", () => {
    const parsed = parseCeoOutput("this is not json");
    expect(parsed.kind).toBe("invalid_json");
  });

  it("returns invalid_json for JSON array", () => {
    const parsed = parseCeoOutput("[1,2,3]");
    expect(parsed.kind).toBe("invalid_json");
  });

  it("returns unknown_action for unknown action value", () => {
    const parsed = parseCeoOutput('{"action":"delete","body":"x"}');
    expect(parsed.kind).toBe("unknown_action");
  });
});

describe("parseExternalCommentRouteOutput", () => {
  it("parses no_action JSON", () => {
    expect(parseExternalCommentRouteOutput('{"action":"no_action"}')).toEqual({ kind: "no_action" });
  });

  it("parses append JSON wrapped in fenced code", () => {
    expect(parseExternalCommentRouteOutput('```json\n{"action":"append","body":"@dev please continue"}\n```')).toEqual({
      kind: "append",
      body: "@dev please continue",
    });
  });

  it("rejects non-object JSON and unknown actions", () => {
    expect(parseExternalCommentRouteOutput("[1,2,3]")).toMatchObject({ kind: "invalid_json" });
    expect(parseExternalCommentRouteOutput('{"action":"replace","body":"x"}')).toMatchObject({
      kind: "unknown_action",
      detail: "replace",
    });
  });
});

describe("formatExternalCommentRoute", () => {
  it("returns NO_ACTION when CEO says no_action", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatExternalCommentRouteInput["runCodex"]>>[0]) =>
      successfulCodexRun(options.runDir, '{"action":"no_action"}'),
    );

    await expect(formatExternalCommentRoute({ ...routeBaseInput, agentsDir, runCodex })).resolves.toEqual({
      action: "NO_ACTION",
      reason: "ceo-no-action",
    });
  });

  it("returns APPEND and targetRole for a single valid non-code mention", async () => {
    const agentsDir = await makeAgentsDir();
    const body = "验收通过。\n\n@dev 请继续实现。";
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatExternalCommentRouteInput["runCodex"]>>[0]) =>
      successfulCodexRun(options.runDir, JSON.stringify({ action: "append", body })),
    );

    await expect(formatExternalCommentRoute({ ...routeBaseInput, agentsDir, runCodex })).resolves.toEqual({
      action: "APPEND",
      body,
      targetRole: "dev",
      reason: "appended",
    });

    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("最新外部无 mention 评论");
    expect(prompt).toContain("可触发 agent:");
    expect(prompt).toContain("dev, product-manager, ceo");
    expect(prompt).toContain("latestExternalComment:");
    expect(prompt).toContain(routeBaseInput.latestComment);
    expect(prompt).not.toContain("ledgerTaskContext:");
  });

  it("injects ledgerTaskContext and the agent-authored intro when ledgerContext is provided", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatExternalCommentRouteInput["runCodex"]>>[0]) =>
      successfulCodexRun(options.runDir, '{"action":"no_action"}'),
    );

    await expect(
      formatExternalCommentRoute({
        ...routeBaseInput,
        agentsDir,
        runCodex,
        ledgerContext: "taskId: task-1\ntitle: child 1\n最新验收事实: 无",
      }),
    ).resolves.toEqual({
      action: "NO_ACTION",
      reason: "ceo-no-action",
    });

    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("agent 自身的无 mention 评论");
    expect(prompt).toContain("ledgerTaskContext:");
    expect(prompt).toContain("taskId: task-1");
    expect(prompt).toContain("指向下一个待发言角色");
  });

  it.each([
    ["non JSON output", "natural language", "invalid-json"],
    ["empty output", "", "empty-output"],
    ["unknown action", '{"action":"delete"}', "unknown-action"],
    ["empty append body", '{"action":"append","body":"   "}', "empty-body"],
    ["append without mention", '{"action":"append","body":"请继续实现。"}', "missing-mention"],
    ["append with multiple mentions", '{"action":"append","body":"@dev 和 @product-manager 请处理。"}', "multiple-mentions"],
    ["append with unknown mention", '{"action":"append","body":"@unknown 请处理。"}', "unknown-mention"],
    ["append with fenced-code-only mention", '{"action":"append","body":"```md\\n@dev\\n```"}', "missing-mention"],
    ["append with inline-code-only mention", '{"action":"append","body":"`@dev`"}', "missing-mention"],
  ])("fail-opens for %s", async (_name, output, reason) => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatExternalCommentRouteInput["runCodex"]>>[0]) =>
      successfulCodexRun(options.runDir, output),
    );

    await expect(formatExternalCommentRoute({ ...routeBaseInput, agentsDir, runCodex })).resolves.toMatchObject({
      action: "FAIL_OPEN",
      reason,
    });
  });

  it("returns APPEND when an unclear external route is handed to CEO", async () => {
    const agentsDir = await makeAgentsDir();
    const body = "@ceo 请裁决下一步路由。";
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatExternalCommentRouteInput["runCodex"]>>[0]) =>
      successfulCodexRun(options.runDir, JSON.stringify({ action: "append", body })),
    );

    await expect(formatExternalCommentRoute({ ...routeBaseInput, agentsDir, runCodex })).resolves.toEqual({
      action: "APPEND",
      body,
      targetRole: "ceo",
      reason: "appended",
    });
  });

  it("fail-opens and aborts a never-settling route Codex run when the timeout fires", async () => {
    const agentsDir = await makeAgentsDir();
    let signal: AbortSignal | undefined;

    const result = await formatExternalCommentRoute({
      ...routeBaseInput,
      agentsDir,
      timeoutMs: 1,
      runCodex: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    });

    expect(result).toMatchObject({ action: "FAIL_OPEN", reason: "codex-timeout" });
    expect(signal?.aborted).toBe(true);
  });
});

describe("formatCeoComment", () => {
  it("replaces a missing marker response when CEO returns a valid repair", async () => {
    const agentsDir = await makeAgentsDir();
    const repairedBody = `> CEO guardrail: 已补齐发布契约。

我已完成验证，测试通过。

<!-- moebius:stage=code-verified -->`;
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "replace", body: repairedBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({
      ...baseInput,
      latestResponse: "我已完成验证，测试通过。",
      agentsDir,
      runCodex,
    });

    expect(result.action).toBe("REPLACE");
    expect(result.body).toContain("我已完成验证，测试通过。");
    expect(result.body).toContain("> CEO guardrail:");
    expect(result.body).toContain("<!-- moebius:stage=code-verified -->");
    expect(result.body.endsWith(CEO_CORRECTED_METADATA)).toBe(true);
  });

  it("returns APPEND when CEO decides to add an independent comment as=ceo", async () => {
    const agentsDir = await makeAgentsDir();
    const appendBody = `> CEO guardrail: 新建 change 分支属于 dev 自主裁决范围。

@dev 同意你提出的分支方案，请自行创建并继续推进 plan-written。`;
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, agentsDir, runCodex });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "ceo",
      reason: "appended",
    });
    if (result.action === "APPEND") {
      expect(result.body).toBe(appendBody);
    }
  });

  it("returns APPEND when CEO corrects GitHub interaction protocol violations", async () => {
    const latestResponse = `我同意 @dev 的说法，请完成 #3。另见 #6 评论里的 #1 验收项。

<!-- moebius:stage=in-progress -->`;
    const appendBody =
      "@dev 你的最新回复把纯提及写成了 `@dev`，并把任务编号写成了 `#3`。按 GitHub 交互协议，任务编号应写成 `T3`，评论位置应写成「第 6 条评论」，验收编号应写成「验收语句 1」；请重新输出合规评论。";
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({
      ...baseInput,
      latestResponse,
      agentsDir: path.resolve("agents"),
      runCodex,
    });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "ceo",
      reason: "appended",
    });
    if (result.action === "APPEND") {
      expect(result.body).toContain("T3");
      expect(result.body).toContain("第 6 条评论");
      expect(result.body).toContain("验收语句 1");
    }
    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("我同意 @dev 的说法");
    expect(prompt).toContain("完成 #3");
    expect(prompt).toContain("另见 #6 评论里的 #1 验收项");
  });

  it("returns APPEND with the plan review template to qa for plan-written", async () => {
    const latestResponse = `方案已落盘。

## 验收语句
1. 跑 pnpm test -- tests/format-ceo.test.ts → 应退出码 0。

<!-- moebius:stage=plan-written -->`;
    const appendBody = makePlanReviewAppendBody();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({
      ...baseInput,
      issueContext: {
        issueUrl: "https://github.com/tranfu-labs/moebius/issues/34",
        issueBody: "需求持有者是 product-manager。\n@dev 请实现验收回流路由。",
        comments: [],
      },
      latestResponse,
      agentsDir: path.resolve("agents"),
      runCodex,
    });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "ceo",
      reason: "appended",
    });
    if (result.action === "APPEND") {
      expect(result.body).toBe(appendBody);
      expectItemsInOrder(result.body, PLAN_REVIEW_TEMPLATE_ITEMS);
      expect(parseAgentMentions(result.body).map((mention) => mention.name)).toEqual(["qa"]);
      expect(result.body).not.toContain("@product-manager");
    }
    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("需求持有者是 product-manager");
    expect(prompt).toContain("<!-- moebius:stage=plan-written -->");
    expect(prompt).toContain("## 验收语句");
    expect(prompt).toContain("请按你的测试设计流程审查并给出结论");
    expectItemsInOrder(appendBody, PLAN_REVIEW_TEMPLATE_ITEMS);
  });

  it("returns APPEND with the post-implementation retro template to the requester for code-verified", async () => {
    const latestResponse = `实现已完成，测试通过。

<!-- moebius:stage=code-verified -->`;
    const appendBody = makeCodeVerifiedRetroAppendBody("product-manager");
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({
      ...baseInput,
      issueContext: {
        issueUrl: "https://github.com/tranfu-labs/moebius/issues/61",
        issueBody: "需求持有者是 product-manager。\n@dev 请实现 T9。",
        comments: [
          {
            body: `&lt;dev&gt;:
方案已落盘。

## 验收语句
1. 打开 agents/ceo.md → 应看到固定模板。

<!-- moebius:stage=plan-written -->
<!-- moebius:role=dev -->`,
          },
        ],
      },
      latestResponse,
      agentsDir: path.resolve("agents"),
      runCodex,
    });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "ceo",
      reason: "appended",
    });
    if (result.action === "APPEND") {
      expect(result.body).toBe(appendBody);
      expectItemsInOrder(result.body, CODE_VERIFIED_RETRO_TEMPLATE_ITEMS);
      expect(parseAgentMentions(result.body).map((mention) => mention.name)).toEqual(["product-manager"]);
      expect(result.body).toContain("dev 已输出");
      expect(result.body).not.toContain("@dev");
    }
    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("需求持有者是 product-manager");
    expect(prompt).toContain("<!-- moebius:stage=code-verified -->");
    expect(prompt).toContain("请按已确认「验收语句」逐条验收实现证据");
    expectItemsInOrder(appendBody, CODE_VERIFIED_RETRO_TEMPLATE_ITEMS);
  });

  it("returns APPEND when CEO asks dev to add missing acceptance statements", async () => {
    const agentsDir = await makeAgentsDir();
    const latestResponse = `方案已落盘，但这里只写了泛泛说明。

<!-- moebius:stage=plan-written -->`;
    const appendBody =
      "@dev 当前 `plan-written` 缺少可逐条核查的「验收语句」清单，请先补齐验收语句后再回流给验收角色。";
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({
      ...baseInput,
      latestResponse,
      agentsDir,
      runCodex,
    });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "ceo",
      reason: "appended",
    });
    if (result.action === "APPEND") {
      expect(result.body).toContain("@dev");
      expect(result.body).toContain("缺少");
      expect(result.body).toContain("补齐验收语句");
    }
  });

  it("returns APPEND with as=dev when CEO impersonates dev", async () => {
    const agentsDir = await makeAgentsDir();
    const appendBody = `> CEO guardrail: 新建 change 分支属于 dev 自主裁决范围。

我按 change/foo 分支方案自行推进 plan-written。

<!-- moebius:stage=in-progress -->`;
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "dev", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, agentsDir, runCodex });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "dev",
    });
    if (result.action === "APPEND") {
      expect(result.body).toContain("<!-- moebius:stage=in-progress -->");
    }
  });

  it("returns APPEND with as=dev-manager when CEO speaks as the tech lead", async () => {
    const agentsDir = await makeAgentsDir();
    const appendBody = `> CEO guardrail: 技术选型属于 dev-manager 裁决范围。

我确认当前架构决策并要求写码方按质量门推进。

<!-- moebius:stage=in-progress -->`;
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "dev-manager", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, agentsDir, runCodex });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "dev-manager",
    });
  });

  it("returns APPEND with as=secretary when CEO delegates rule maintenance", async () => {
    const agentsDir = await makeAgentsDir();
    const appendBody = `> CEO guardrail: 这属于 CEO 规则进化事项。

我会采访并维护 CEO guardrail 规则。

<!-- moebius:stage=in-progress -->`;
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "secretary", body: appendBody }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, agentsDir, runCodex });

    expect(result).toMatchObject({
      action: "APPEND",
      as: "secretary",
    });
  });

  it("fail-opens CEO self-loop append decisions for CEO agent responses", async () => {
    const agentsDir = await makeAgentsDir();
    const appendAsCeo = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "ceo", body: "@dev 这里不是正文回交 CEO。" }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    await expect(formatCeoComment({ ...baseInput, agent: "ceo", agentsDir, runCodex: appendAsCeo })).resolves.toMatchObject({
      action: "FAIL_OPEN",
      reason: "post-validate-failed",
    });

    const appendMentionCeo = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: JSON.stringify({ action: "append", as: "qa", body: "@ceo 请继续。" }),
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    await expect(
      formatCeoComment({ ...baseInput, agent: "ceo", agentsDir, runCodex: appendMentionCeo }),
    ).resolves.toMatchObject({
      action: "FAIL_OPEN",
      reason: "post-validate-failed",
    });
  });

  it("returns the original body when CEO says no_change", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '```json\n{"action":"no_change"}\n```',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, agentsDir, runCodex });

    expect(result).toMatchObject({
      action: "NO_CHANGE",
      body: baseInput.latestResponse,
      reason: "ceo-no-change",
    });
  });

  it("passes full public issue context to CEO prompt", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"no_change"}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    await formatCeoComment({
      ...baseInput,
      issueContext: {
        issueUrl: "https://github.com/tranfu-labs/moebius/issues/20",
        issueBody: "全局流程：先采访再方案",
        comments: [
          { body: "临时修改：本次不需要额外 token 统计" },
          {
            body: "&lt;reflector&gt;:\n@dev 请反思\n<!-- moebius:stage-hook source=dev stage=plan-written sourceIndex=7 -->",
          },
        ],
      },
      latestResponse: "我准备发布的最新响应",
      agentsDir,
      runCodex,
    });

    const prompt = runCodex.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("完整公开 issue 上下文");
    expect(prompt).toContain("latestResponse 是本轮唯一待发布的 agent 响应");
    expect(prompt).toContain("issueContext.issueUrl:");
    expect(prompt).toContain("https://github.com/tranfu-labs/moebius/issues/20");
    expect(prompt).toContain("issueContext.issueBody:");
    expect(prompt).toContain("全局流程：先采访再方案");
    expect(prompt).toContain("#1 comment:");
    expect(prompt).toContain("临时修改：本次不需要额外 token 统计");
    expect(prompt).toContain("#2 comment:");
    expect(prompt).toContain("stage-hook source=dev stage=plan-written");
    expect(prompt).toContain("latestResponse:");
    expect(prompt).toContain("我准备发布的最新响应");
    expect(prompt).not.toContain("lastReflectorHook:");
    expect(prompt).not.toContain("originalRequest:");
  });

  it("does not invoke CEO again for already corrected text", async () => {
    const runCodex = vi.fn();
    const latestResponse = `done

${CEO_CORRECTED_METADATA}`;

    const result = await formatCeoComment({ ...baseInput, latestResponse, runCodex });

    expect(result).toMatchObject({
      action: "NO_CHANGE",
      body: latestResponse,
      reason: "already-corrected",
    });
    expect(runCodex).not.toHaveBeenCalled();
  });

  it("fail-opens when CEO returns non-JSON output", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: "自然语言而不是 JSON",
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "invalid-json" });
  });

  it("fail-opens when CEO returns an unknown action", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"delete","body":"x"}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "unknown-action" });
  });

  it("fail-opens when append.as is not in allowed set", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"append","as":"nobody","body":"..."}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "unknown-as" });
  });

  it("fail-opens when append.as is the removed reflector role", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"append","as":"reflector","body":"..."}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "unknown-as" });
  });

  it("fail-opens when append body is empty", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"append","as":"ceo","body":"   "}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "empty-body" });
  });

  it("fail-opens when replace body lacks a valid trailing stage marker", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"replace","body":"修正版但没有 marker"}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "post-validate-failed" });
  });

  it("fail-opens when replace body stage marker is outside AllStages", async () => {
    const agentsDir = await makeAgentsDir();
    const runCodex = vi.fn(async (options: Parameters<NonNullable<FormatCeoInput["runCodex"]>>[0]) => ({
      ok: true as const,
      finalText: '{"action":"replace","body":"修正版\\n<!-- moebius:stage=done -->"}',
      threadId: "ceo-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const result = await formatCeoComment({ ...baseInput, latestResponse: "原文", agentsDir, runCodex });

    expect(result).toMatchObject({ action: "FAIL_OPEN", body: "原文", reason: "post-validate-failed" });
  });

  it("fail-opens when CEO throws, times out, or returns empty text", async () => {
    const agentsDir = await makeAgentsDir();
    await expect(
      formatCeoComment({
        ...baseInput,
        agentsDir,
        runCodex: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toMatchObject({ action: "FAIL_OPEN", reason: "codex-failed" });

    await expect(
      formatCeoComment({
        ...baseInput,
        agentsDir,
        timeoutMs: 1,
        runCodex: () => new Promise(() => {}),
      }),
    ).resolves.toMatchObject({ action: "FAIL_OPEN", reason: "codex-timeout" });

    await expect(
      formatCeoComment({
        ...baseInput,
        agentsDir,
        runCodex: async (options) => ({
          ok: true as const,
          finalText: "",
          threadId: "ceo-thread",
          cachedInputTokens: null,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        }),
      }),
    ).resolves.toMatchObject({ action: "FAIL_OPEN", reason: "invalid-json" });
  });

  it("aborts the CEO Codex run when timeout fires", async () => {
    const agentsDir = await makeAgentsDir();
    let signal: AbortSignal | undefined;

    const result = await formatCeoComment({
      ...baseInput,
      agentsDir,
      timeoutMs: 1,
      runCodex: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    });

    expect(result).toMatchObject({ action: "FAIL_OPEN", reason: "codex-timeout" });
    expect(signal?.aborted).toBe(true);
  });
});

const baseInput: Omit<FormatCeoInput, "agentsDir" | "runCodex"> = {
  agent: "dev",
  issueContext: {
    issueUrl: "https://github.com/tranfu-labs/moebius/issues/4",
    issueBody: "@dev please fix",
    comments: [],
  },
  latestResponse: "done\n<!-- moebius:stage=in-progress -->",
  runDir: path.join(os.tmpdir(), "moebius-ceo-test"),
};

const routeBaseInput: Omit<FormatExternalCommentRouteInput, "agentsDir" | "runCodex"> = {
  issueContext: {
    issueUrl: "https://github.com/tranfu-labs/moebius/issues/4",
    issueBody: "@dev please fix",
    comments: [{ body: "验收通过，请继续实现。" }],
  },
  latestComment: "验收通过，请继续实现。",
  availableAgentNames: ["dev", "product-manager", "ceo"],
  runDir: path.join(os.tmpdir(), "moebius-external-route-test"),
};

async function makeAgentsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agents-"));
  await fs.writeFile(path.join(dir, "ceo.md"), "CEO persona", "utf8");
  return dir;
}

function successfulCodexRun(runDir: string, finalText: string) {
  return {
    ok: true as const,
    finalText,
    threadId: "ceo-thread",
    cachedInputTokens: null,
    runDir,
    stdoutPath: path.join(runDir, "stdout.jsonl"),
    stderrPath: path.join(runDir, "stderr.log"),
  };
}

function makePlanReviewAppendBody(): string {
  return "@qa 本轮方案已输出 `plan-written` 且含「验收语句」清单，请按你的测试设计流程审查并给出结论。";
}

function makeCodeVerifiedRetroAppendBody(requester: string): string {
  return `@${requester} dev 已输出 \`code-verified\`，请按已确认「验收语句」逐条验收实现证据；任一不通过时指出未过语句、实际观察与期望差异。`;
}

function expectItemsInOrder(text: string, items: string[]): void {
  let previousIndex = -1;
  for (const item of items) {
    const itemIndex = text.indexOf(item);
    expect(itemIndex).toBeGreaterThan(previousIndex);
    previousIndex = itemIndex;
  }
}
