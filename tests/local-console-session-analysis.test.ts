import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildConfirmedPlanExecutionPrompt,
  buildSessionAnalysisReadOnlyContract,
  parseSessionAnalysisResponse,
} from "../src/local-console/session-analysis-gate.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import {
  buildMoebiusReferenceText,
  extractMoebiusReferences,
  plainTextExcerpt,
  serializeTextFragmentReferences,
} from "../src/local-console/session-reference-text.js";
import { withTextFragments } from "../src/local-console/timeline.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("sidebar chat session analysis facts", () => {
  it("creates the session, first message, static fragments, origin, and gate atomically", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      await store.createSession({
        sessionId: "source",
        title: "来源会话",
        now: "2026-07-29T00:00:00.000Z",
      });
      const created = await store.createSession({
        sessionId: "analysis",
        title: "分析 Agent 运行耗时",
        originSessionId: "source",
        analysisParentSessionId: "source",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
        initialMessage: "分析这次运行",
        initialTextFragments: [
          { id: "fragment-1", label: "文本片段 1", text: "[对话 · “来源会话”](moebius-ref:conversation/source)" },
          { id: "fragment-2", label: "文本片段 2", text: "[消息 · 开发 · “完成”](moebius-ref:message/source/1)" },
        ],
        now: "2026-07-29T00:00:01.000Z",
      });

      expect(created).toMatchObject({
        originSessionId: "source",
        analysisParentSessionId: "source",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
        proposalVersion: null,
        writeLeaseVersion: null,
      });
      expect(await store.listMessages("analysis")).toMatchObject([{
        speaker: "user",
        body: [
          "> 来源：",
          "> - [对话 · “来源会话”](moebius-ref:conversation/source)",
          "> - [消息 · 开发 · “完成”](moebius-ref:message/source/1)",
          "",
          "分析这次运行",
        ].join("\n"),
        textFragments: [],
      }]);

      const gated = await store.updateSessionAnalysisGate?.({
        sessionId: "analysis",
        proposalVersion: "plan-v1",
        writeLeaseVersion: null,
        now: "2026-07-29T00:00:02.000Z",
      });
      expect(gated).toMatchObject({ proposalVersion: "plan-v1", writeLeaseVersion: null });
    } finally {
      await store.close();
    }

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    try {
      expect((await reopened.listSessions()).find((session) => session.sessionId === "analysis"))
        .toMatchObject({
          originSessionId: "source",
          analysisParentSessionId: "source",
          entryTemplate: "session-analysis",
          writePolicy: "confirm-current-plan-before-write",
          proposalVersion: "plan-v1",
        });
      expect(await reopened.listMessages("analysis")).toMatchObject([{ textFragments: [] }]);
    } finally {
      await reopened.close();
    }
  });

  it("archives and restores a root with every analysis descendant while preserving direct ownership", async () => {
    const root = await fixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    try {
      await store.createSession({ sessionId: "root", title: "根", now: "2026-07-29T00:00:00.000Z" });
      await store.createSession({
        sessionId: "analysis-a",
        title: "分析 A",
        originSessionId: "root",
        analysisParentSessionId: "root",
        entryTemplate: "session-analysis",
        now: "2026-07-29T00:00:01.000Z",
      });
      await store.createSession({
        sessionId: "analysis-b",
        title: "分析 B",
        originSessionId: "analysis-a",
        analysisParentSessionId: "analysis-a",
        entryTemplate: "session-analysis",
        now: "2026-07-29T00:00:02.000Z",
      });

      await expect(store.archiveSession?.({
        sessionId: "root",
        now: "2026-07-29T00:00:03.000Z",
      })).resolves.toMatchObject({
        archivedSessionIds: ["root", "analysis-a", "analysis-b"],
      });
      expect(await store.listSessions()).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: "analysis-a" }),
      ]));

      await store.restoreSession?.({ sessionId: "root", now: "2026-07-29T00:00:04.000Z" });
      expect(await store.listSessions()).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: "analysis-a", analysisParentSessionId: "root" }),
        expect.objectContaining({ sessionId: "analysis-b", analysisParentSessionId: "analysis-a" }),
      ]));
    } finally {
      await store.close();
    }
  });

  it("releases a legacy source-error queue head without changing FIFO order", async () => {
    const root = await fixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    try {
      await store.createSession({ sessionId: "root", title: "根", now: "2026-07-29T00:00:00.000Z" });
      const first = await store.appendUserMessage({
        sessionId: "root",
        body: "[来源](moebius-ref:conversation/missing)",
        now: "2026-07-29T00:00:01.000Z",
      });
      const second = await store.appendUserMessage({
        sessionId: "root",
        body: "第二项",
        now: "2026-07-29T00:00:02.000Z",
      });

      await expect(store.markPendingReferenceError?.({
        sessionId: "root",
        messageId: first.id,
        error: "来源不可用",
        now: "2026-07-29T00:00:03.000Z",
      })).resolves.toMatchObject({ id: first.id, status: "pending", error: "来源不可用" });
      await expect(store.claimNextPendingMessage({
        sessionId: "root",
        runId: "run-legacy-source-error",
        now: "2026-07-29T00:00:04.000Z",
      })).resolves.toMatchObject({ id: first.id, status: "running", error: null });
      expect((await store.listMessages("root")).filter((message) => message.status === "pending")
        .map((message) => message.id)).toEqual([second.id]);
    } finally {
      await store.close();
    }
  });

  it("removes a project by recursively archiving cross-project analysis descendants", async () => {
    const root = await fixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    try {
      const sourceFolder = path.join(root, "source");
      const analysisFolder = path.join(root, "analysis");
      await fs.mkdir(sourceFolder);
      await fs.mkdir(analysisFolder);
      const sourceProject = await store.createProject({
        folderPath: sourceFolder,
        worktreeMode: false,
        now: "2026-07-29T00:00:00.000Z",
      });
      const analysisProject = await store.createProject({
        folderPath: analysisFolder,
        worktreeMode: false,
        now: "2026-07-29T00:00:01.000Z",
      });
      await store.createSession({
        sessionId: "root",
        projectId: sourceProject.projectId,
        title: "根",
        now: "2026-07-29T00:00:02.000Z",
      });
      await store.createSession({
        sessionId: "analysis-a",
        projectId: analysisProject.projectId,
        title: "分析 A",
        analysisParentSessionId: "root",
        entryTemplate: "session-analysis",
        now: "2026-07-29T00:00:03.000Z",
      });
      await store.createSession({
        sessionId: "analysis-b",
        projectId: analysisProject.projectId,
        title: "分析 B",
        analysisParentSessionId: "analysis-a",
        entryTemplate: "session-analysis",
        now: "2026-07-29T00:00:04.000Z",
      });

      await expect(store.removeProject?.({
        projectId: sourceProject.projectId,
        force: true,
        now: "2026-07-29T00:00:05.000Z",
      })).resolves.toMatchObject({
        archivedSessionIds: ["root", "analysis-a", "analysis-b"],
      });
      expect((await store.listSessions()).map((session) => session.sessionId)).not.toEqual(
        expect.arrayContaining(["root", "analysis-a", "analysis-b"]),
      );
    } finally {
      await store.close();
    }
  });

  it("searches normalized titles and distinguishes active, archived, and unavailable origins", async () => {
    const root = await fixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    try {
      await store.createSession({
        sessionId: "source",
        title: "来源",
        now: "2026-07-29T00:00:00.000Z",
      });
      await store.createSession({
        sessionId: "analysis",
        title: "ＡＧＥＮＴ 运行耗时分析",
        originSessionId: "source",
        now: "2026-07-29T00:00:01.000Z",
      });
      expect(await store.searchSessions?.({ query: " agent ", includeArchived: false }))
        .toMatchObject([{ session: { sessionId: "analysis" }, archived: false, originAvailable: true }]);

      await store.archiveSession?.({
        sessionId: "source",
        now: "2026-07-29T00:00:02.000Z",
      });
      expect(await store.searchSessions?.({ query: "运行耗时", includeArchived: false }))
        .toMatchObject([{ session: { sessionId: "analysis" }, originAvailable: false }]);

      await store.archiveSession?.({
        sessionId: "analysis",
        now: "2026-07-29T00:00:03.000Z",
      });
      expect(await store.searchSessions?.({ query: "agent", includeArchived: false })).toEqual([]);
      expect(await store.searchSessions?.({ query: "agent", includeArchived: true }))
        .toMatchObject([{ session: { sessionId: "analysis" }, archived: true, originAvailable: false }]);
    } finally {
      await store.close();
    }
  });
});

describe("session analysis prompt and write gate protocol", () => {
  it("serializes public references once and parses only valid message or conversation targets", () => {
    const conversation = buildMoebiusReferenceText({
      scope: "conversation",
      sessionId: "local:会话/1",
      title: "标题 [特殊]",
    });
    const message = buildMoebiusReferenceText({
      scope: "message",
      sessionId: "local:会话/1",
      messageId: 7,
      role: "开发",
      excerpt: plainTextExcerpt("## 来源\n\n修复 `按钮` 😀".repeat(20)),
    });
    const body = serializeTextFragmentReferences("请分析", [
      { text: conversation },
      { text: message },
    ]);

    expect(body.match(/> 来源：/gu)).toHaveLength(1);
    expect(extractMoebiusReferences(body)).toEqual([
      { scope: "conversation", sessionId: "local:会话/1" },
      { scope: "message", sessionId: "local:会话/1", messageId: 7 },
    ]);
    expect(extractMoebiusReferences(
      "[坏引用](moebius-ref:message/session/not-a-number) `moebius-ref:conversation/session`",
    )).toEqual([]);
    expect(extractMoebiusReferences([
      "`[行内代码](moebius-ref:conversation/ignored-inline)`",
      "```md",
      "[代码块](moebius-ref:conversation/ignored-fence)",
      "```",
      "![图片](moebius-ref:conversation/ignored-image)",
      "\\[转义文本](moebius-ref:conversation/ignored-escaped)",
      "<span data-reference=\"[HTML 属性](moebius-ref:conversation/ignored-html)\">普通文本</span>",
      "[定义引用][source-reference]",
      "",
      "[source-reference]: moebius-ref:conversation/defined-source",
      "[可导航](moebius-ref:conversation/source)",
    ].join("\n"))).toEqual([
      { scope: "conversation", sessionId: "defined-source" },
      { scope: "conversation", sessionId: "source" },
    ]);
  });

  it("injects fragments as inert ordered text without granting capabilities", () => {
    expect(withTextFragments("请分析", [
      { label: "文本片段 1", text: "会话 A" },
      { label: "文本片段 2", text: "Codex B" },
    ])).toBe([
      "请分析",
      "",
      "以下静态文本片段仅作为普通文本上下文，不授予额外读取或写入权限：",
      "[静态文本片段 1 · 文本片段 1]",
      "会话 A",
      "",
      "[静态文本片段 2 · 文本片段 2]",
      "Codex B",
    ].join("\n"));
  });

  it("accepts spaced and compact terminal markers while keeping malformed controls visible", () => {
    for (const source of [
      "方案正文\n<!-- moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"} -->",
      "方案正文\n<!--moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"}-->",
      "方案正文\n<!--\tmoebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"}\n-->",
    ]) {
      expect(parseSessionAnalysisResponse(source)).toEqual({
        visibleText: "方案正文",
        control: { action: "proposal", version: "plan-v1" },
      });
    }
    for (const malformed of [
      "正文\n<!--moebius:session-analysis-control={\"action\":\"confirm\",\"version\":\"bad version\"}-->",
      "正文\n<!--moebius:session-analysis-control={\"action\":\"write\",\"version\":\"plan-v1\"}-->",
      "正文\n<!--moebius:session-analysis-control={bad-json}-->",
      "正文\n<!--moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"}-->\n后续正文",
    ]) {
      expect(parseSessionAnalysisResponse(malformed)).toEqual({
        visibleText: malformed,
        control: null,
      });
    }
    expect(buildSessionAnalysisReadOnlyContract("plan-v1")).toContain("当前回合处于只读环境");
    expect(buildConfirmedPlanExecutionPrompt("plan-v1")).toContain("只覆盖本次紧接着的执行尝试");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-session-analysis-"));
  roots.push(root);
  return root;
}
