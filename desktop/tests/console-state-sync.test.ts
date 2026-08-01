import { describe, expect, it, vi } from "vitest";
import {
  EXECUTION_MODEL_REGISTRY,
  translate,
  type OperatorProcessOutput,
} from "@moebius/console-ui";
import { TRUSTED_EXECUTION_REGISTRY } from "../../src/execution-profile-registry.js";
import {
  acknowledgeDisplayedResult,
  ConsoleStateActions,
  createSidebarConversationSession,
  loadEvidenceView,
  loadProcessDebugInvocation,
  loadProcessOutput,
  loadProcessOutputAppend,
  loadProcessOutputUpdate,
  loadSubSessionView,
  loadSessionReferenceText,
  loadProjectFile,
  loadFileReference,
  loadExecutionProfileRegistry,
  loadProjectFiles,
  loadWorkspaceDiff,
  refreshConsoleState,
  restoreConsoleSession,
  retryPendingSessionMessage,
  retrySessionRun,
  removePendingSessionMessage,
  submitSessionMessage,
  updatePendingSessionMessage,
  searchConsoleSessions,
} from "../src/console-page/state-sync.js";
import { createBrowserFetchPort } from "../src/console-page/browser-fetch.js";
import {
  mergeSettledProcessOutput,
  ProcessOutputRequestError,
  processOutputLocator,
  processOutputRunId,
  subSessionIdFromSourceKey,
} from "../src/console-page/console-process-model.js";
import {
  ConsoleStateCoordinator,
  ProcessInvocationRequestCoordinator,
  SessionViewTransitionQueue,
  type ConsoleSelection,
  type SelectionMutationKind,
} from "../src/console-page/console-state-coordinator.js";

describe("execution profile registry state sync", () => {
  it("keeps server admission and the team-page registry in lockstep", () => {
    expect(TRUSTED_EXECUTION_REGISTRY).toEqual(EXECUTION_MODEL_REGISTRY);
  });

  it("loads the trusted serializable registry", async () => {
    const registry = {
      codex: [{
        value: "gpt-5.6-sol",
        label: "gpt-5.6-sol",
        efforts: ["high"],
        defaultEffort: "high",
        membershipRestricted: false,
      }],
      claude: [],
      kimi: [],
    };
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ registry }));
    await expect(loadExecutionProfileRegistry({
      apiBase: "http://127.0.0.1:8787/",
      fetch,
    })).resolves.toEqual(registry);
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/execution-profiles"),
      undefined,
    );
  });

  it("creates a fresh single-run intent for each confirmed override retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));
    const input = {
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session-a",
      runId: "run-timeout",
      executionOverride: {
        cli: "codex" as const,
        model: "gpt-5.6-sol",
        effort: "high",
      },
      fetch,
    };

    await retrySessionRun(input);
    await retrySessionRun(input);

    const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      executionOverride: { overrideId: string };
    };
    const second = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as {
      executionOverride: { overrideId: string };
    };
    expect(first.executionOverride.overrideId).toMatch(/^single-run:run-timeout:/u);
    expect(second.executionOverride.overrideId).toMatch(/^single-run:run-timeout:/u);
    expect(second.executionOverride.overrideId).not.toBe(first.executionOverride.overrideId);
  });
});

describe("sidebar conversation state sync", () => {
  it("submits creation facts in one request and keeps caller-owned draft state on failure", async () => {
    const fetch = vi.fn(function (
      this: unknown,
      _input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: "project-a",
        initialMessage: "分析耗时",
        agentTeamOwnership: "system",
        agentTeamId: "general-assistant",
        workspaceMode: "worktree",
        attachmentIds: ["attachment-a"],
        attachmentDraftKey: "draft-a",
        originSessionId: "source-a",
        analysisParentSessionId: "source-a",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
        textFragments: [{ id: "fragment-a", label: "文本片段 1", text: "静态文本" }],
      });
      return Promise.resolve(jsonResponse({ error: "create failed" }, 500));
    });
    const draft = {
      body: "分析耗时",
      fragments: [{ id: "fragment-a", label: "文本片段 1", text: "静态文本" }],
    };

    await expect(createSidebarConversationSession({
      apiBase: "http://127.0.0.1:8787/",
      projectId: "project-a",
      initialMessage: draft.body,
      agentTeam: { ownership: "system", id: "general-assistant" },
      workspaceMode: "worktree",
      attachmentIds: ["attachment-a"],
      attachmentDraftKey: "draft-a",
      originSessionId: "source-a",
      entryTemplate: "session-analysis",
      writePolicy: "confirm-current-plan-before-write",
      textFragments: draft.fragments,
      fetch: createBrowserFetchPort(fetch),
    })).rejects.toThrow("create failed");
    expect(draft).toEqual({
      body: "分析耗时",
      fragments: [{ id: "fragment-a", label: "文本片段 1", text: "静态文本" }],
    });
  });

  it("encodes trusted reference, search, and restore requests without deriving facts in the renderer", async () => {
    const fetch = vi.fn(function (
      this: unknown,
      input: string | URL | Request,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      if (url.pathname.endsWith("/reference-text")) {
        expect(url.searchParams.get("scope")).toBe("message");
        expect(url.searchParams.get("runId")).toBe("run/1");
        expect(url.searchParams.get("messageId")).toBe("17");
        return Promise.resolve(jsonResponse({
          fragment: { id: "fragment", label: "文本片段", text: "服务端生成" },
        }));
      }
      if (url.pathname.endsWith("/search")) {
        expect(url.searchParams.get("query")).toBe(" 分析 ");
        expect(url.searchParams.get("includeArchived")).toBe("true");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      expect(url.pathname).toBe("/api/local-console/sessions/session%2F1/restore");
      expect(init?.method).toBe("POST");
      return Promise.resolve(jsonResponse({ session: { sessionId: "session/1", title: "分析" } }));
    });
    const controller = new AbortController();

    await expect(loadSessionReferenceText({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/1",
      scope: "message",
      runId: "run/1",
      messageId: 17,
      fetch: createBrowserFetchPort(fetch),
    })).resolves.toEqual({
      fragment: { id: "fragment", label: "文本片段", text: "服务端生成" },
    });
    await expect(searchConsoleSessions({
      apiBase: "http://127.0.0.1:8787/",
      query: " 分析 ",
      includeArchived: true,
      signal: controller.signal,
      fetch: createBrowserFetchPort(fetch),
    })).resolves.toEqual([]);
    await expect(restoreConsoleSession({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/1",
      fetch: createBrowserFetchPort(fetch),
    })).resolves.toMatchObject({ sessionId: "session/1", title: "分析" });
  });
});

interface TestState {
  selectedProjectId: string;
  selectedSessionId: string;
}

const zhT: Parameters<typeof loadEvidenceView>[0]["t"] = (key, values) =>
  translate("zh-CN", key, values);

describe("ProcessInvocationRequestCoordinator", () => {
  it("isolates run keys, rejects stale slow responses, and aborts all work on session change", () => {
    const coordinator = new ProcessInvocationRequestCoordinator();
    const slowA = coordinator.begin("session-a:run-a");
    const requestB = coordinator.begin("session-b:run-b");
    expect(coordinator.isCurrent("session-a:run-a", slowA)).toBe(true);
    expect(coordinator.isCurrent("session-b:run-b", requestB)).toBe(true);

    const retryA = coordinator.begin("session-a:run-a");
    expect(slowA.signal.aborted).toBe(true);
    expect(coordinator.finish("session-a:run-a", slowA)).toBe(false);
    expect(coordinator.finish("session-a:run-a", retryA)).toBe(true);
    expect(coordinator.finish("session-b:run-b", requestB)).toBe(true);

    const requestC = coordinator.begin("session-c:run-c");
    coordinator.abortAll();
    expect(requestC.signal.aborted).toBe(true);
    expect(coordinator.isCurrent("session-c:run-c", requestC)).toBe(false);
  });
});

describe("SessionViewTransitionQueue", () => {
  it("serializes requests and keeps the latest generation pending", async () => {
    const queue = new SessionViewTransitionQueue();
    const firstTask = deferred<void>();
    const secondTask = deferred<void>();
    const started: string[] = [];
    const first = queue.enqueue(async () => {
      started.push("first");
      await firstTask.promise;
    });
    const second = queue.enqueue(async () => {
      started.push("second");
      await secondTask.promise;
    });

    await vi.waitFor(() => expect(started).toEqual(["first"]));
    expect(queue.isPending).toBe(true);
    expect(queue.isLatest(first.generation)).toBe(false);
    expect(queue.isLatest(second.generation)).toBe(true);

    firstTask.resolve(undefined);
    await first.completion;
    expect(queue.isPending).toBe(true);
    await vi.waitFor(() => expect(started).toEqual(["first", "second"]));

    secondTask.resolve(undefined);
    await second.completion;
    expect(queue.isPending).toBe(false);
  });

  it("continues with the next request after a failure", async () => {
    const queue = new SessionViewTransitionQueue();
    const started: string[] = [];
    const failed = queue.enqueue(async () => {
      started.push("failed");
      throw new Error("mutation failed");
    });
    const continued = queue.enqueue(async () => {
      started.push("continued");
    });

    await expect(failed.completion).rejects.toThrow("mutation failed");
    await continued.completion;
    expect(started).toEqual(["failed", "continued"]);
    expect(queue.isPending).toBe(false);
  });
});

describe("refreshConsoleState", () => {
  it("keeps a slow periodic refresh single-flight and eventually commits it", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const response = deferred<Response>();
    const fetch = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      return response.promise;
    });
    const committed: TestState[] = [];
    const options = refreshOptions({ coordinator, fetch, committed });

    const slowRefresh = refreshConsoleState(options);
    const nextIntervalTick = await refreshConsoleState(options);

    expect(nextIntervalTick).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(jsonResponse({ selectedProjectId: "project-a", selectedSessionId: "session-a" }));

    await expect(slowRefresh).resolves.toBe(true);
    expect(committed).toEqual([{ selectedProjectId: "project-a", selectedSessionId: "session-a" }]);
  });

  it("drops an old selection response after a mutation and commits the explicit new selection", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    const fetch = vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise);
    const committed: TestState[] = [];
    const oldRefresh = refreshConsoleState(refreshOptions({ coordinator, fetch, committed }));

    const token = coordinator.beginSelectionMutation("rebind-session");
    expect(token).not.toBeNull();
    const nextSelection = { projectId: "project-b", sessionId: "session-a" };
    const newRefresh = refreshConsoleState(refreshOptions({
      coordinator,
      fetch,
      committed,
      selection: nextSelection,
      mutationOwner: token!,
    }));
    newResponse.resolve(jsonResponse({ selectedProjectId: "project-b", selectedSessionId: "session-a" }));
    await expect(newRefresh).resolves.toBe(true);

    oldResponse.resolve(jsonResponse({ selectedProjectId: "project-a", selectedSessionId: "session-a" }));
    await expect(oldRefresh).resolves.toBe(false);
    expect(committed).toEqual([{ selectedProjectId: "project-b", selectedSessionId: "session-a" }]);
    expect(coordinator.endSelectionMutation(token!)).toBe(true);
  });
});

describe("acknowledgeDisplayedResult", () => {
  it("acknowledges the exact unread timestamp after the result is displayed", async () => {
    const fetch = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      return Promise.resolve(jsonResponse({ cleared: true }));
    });

    await expect(acknowledgeDisplayedResult({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      unreadSince: "2026-07-09T00:00:02.000Z",
      fetch,
    })).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/sessions/session%2Fa/read"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ unreadSince: "2026-07-09T00:00:02.000Z" }),
      }),
    );
  });
});

describe("sub-session adapters", () => {
  it("parses only a non-empty sub-session source key", () => {
    expect(subSessionIdFromSourceKey("sub-session:child/a")).toBe("child/a");
    expect(subSessionIdFromSourceKey("run-output:child/a")).toBeNull();
    expect(subSessionIdFromSourceKey("sub-session:")).toBeNull();
    expect(subSessionIdFromSourceKey(null)).toBeNull();
  });

  it("loads and advances the exact child session", async () => {
    const view = {
      session: { sessionId: "child/a" },
      messages: [],
      activeRun: null,
    };
    let requestCount = 0;
    const fetch = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      requestCount += 1;
      return Promise.resolve(requestCount === 1
        ? jsonResponse(view)
        : jsonResponse({ accepted: true }, 202));
    });

    await expect(loadSubSessionView({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      fetch,
    })).resolves.toEqual(view);
    await expect(submitSessionMessage({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      body: "@qa 继续验收",
      attachmentIds: ["attachment-1"],
      resumeRunId: "run-stopped",
      fetch,
    })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/child%2Fa/view"),
      undefined,
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/child%2Fa/messages"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "@qa 继续验收",
          attachmentIds: ["attachment-1"],
          resumeRunId: "run-stopped",
        }),
      }),
    );

    await expect(retrySessionRun({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      runId: "run/stuck",
      fetch,
    })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/child%2Fa/runs/run%2Fstuck/retry"),
      {
        body: "{}",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    );

    await retryPendingSessionMessage({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      messageId: 7,
      fetch,
    });
    await updatePendingSessionMessage({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      messageId: 7,
      body: "修正引用",
      fetch,
    });
    await removePendingSessionMessage({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "child/a",
      messageId: 7,
      fetch,
    });
    const pendingUrl = new URL(
      "http://127.0.0.1:8787/api/local-console/sessions/child%2Fa/messages/7/pending",
    );
    expect(fetch).toHaveBeenNthCalledWith(4, pendingUrl, { method: "POST" });
    expect(fetch).toHaveBeenNthCalledWith(5, pendingUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "修正引用" }),
    });
    expect(fetch).toHaveBeenNthCalledWith(6, pendingUrl, { method: "DELETE" });
  });
});

describe("loadEvidenceView", () => {
  it("builds the diff fallback without requesting a file list", async () => {
    const fetch = vi.fn();
    await expect(loadEvidenceView({
      apiBase: "http://127.0.0.1:8787/",
      intent: { kind: "workspace-diff", sessionId: "session-a", fileCount: 0 },
      fetch,
      t: zhT,
    })).resolves.toEqual({
      kind: "workspace-diff",
      title: "对话改动",
      content: "这段对话期间没有文件发生改动。",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads persisted run output using the session and run locator", async () => {
    const fetch = vi.fn(function (this: unknown, _input: string | URL | Request) {
      expect(this).toBeUndefined();
      return Promise.resolve(jsonResponse({
        stdout: "complete stdout",
        stderr: "complete stderr",
        fallback: "recorded fallback",
      }));
    });
    const view = await loadEvidenceView({
      apiBase: "http://127.0.0.1:8787/",
      intent: {
        kind: "run-output",
        sessionId: "session-a",
        runId: "run-1",
        stepId: null,
        role: "dev",
        fallbackOutput: null,
      },
      fetch,
      t: zhT,
    });

    expect(String(fetch.mock.calls[0]?.[0])).toContain("sessions/session-a/runs/run-1/output");
    expect(view).toEqual({
      kind: "run-output",
      title: "开发 · 完整输出",
      content: "标准输出\ncomplete stdout\n\n错误输出\ncomplete stderr\n\n记录\nrecorded fallback",
    });
  });
});

describe("loadProcessOutput", () => {
  it("loads the active process tab through the aggregate HTTP endpoint", async () => {
    const output = {
      sessionId: "local:session/a",
      requestedRunId: "run/2",
      role: "dev",
      status: "running" as const,
      attempts: [{
        runId: "run/2",
        attempt: 1,
        startedAt: "2026-07-09T00:00:00.000Z",
        status: "running" as const,
        stdout: "raw /tmp/output",
        stderr: null,
        fallback: null,
        availability: "available" as const,
        stdoutTruncated: false,
        stderrTruncated: false,
      }],
    };
    const fetch = receiverSensitiveFetch(jsonResponse(output));

    await expect(loadProcessOutput({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: output.sessionId,
      runId: output.requestedRunId,
      fetch,
    })).resolves.toEqual(output);

    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/sessions/local%3Asession%2Fa/runs/run%2F2/process-output",
    );
  });

  it("resolves a persisted source key against the whole selected session id", () => {
    expect(processOutputRunId(
      "run-output:local:project:session-a:run:retry-2",
      "local:project:session-a",
    )).toBe("run:retry-2");
    expect(processOutputRunId("run-output:other:run-1", "session-a")).toBeNull();
  });
});

describe("workspace file readers", () => {
  it("loads diff, project tree, and selected file through session-scoped read-only routes", async () => {
    const fetch = receiverSensitiveFetch(
      jsonResponse({
        available: true,
        fileCount: 1,
        files: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
        reason: null,
        workspaceMode: "direct",
      }),
      jsonResponse({
        available: true,
        files: [{ path: "README.md", additions: null, deletions: null, changed: false }],
        reason: null,
        workspaceMode: "direct",
      }),
      jsonResponse({
        available: true,
        path: "README.md",
        lines: [{ kind: "unchanged", oldLineNumber: 1, newLineNumber: 1, text: "# Project" }],
        reason: null,
      }),
      jsonResponse({
        available: true,
        path: "/Users/wing/.codex/sessions/rollout.jsonl",
        lines: [{ lineNumber: 292, text: "target" }],
        reason: null,
        targetLine: 292,
        targetColumn: 7,
        truncatedBefore: true,
        truncatedAfter: true,
      }),
    );

    await expect(loadWorkspaceDiff({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      fetch,
    })).resolves.toMatchObject({ available: true, fileCount: 1 });
    await expect(loadProjectFiles({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      fetch,
    })).resolves.toMatchObject({ available: true, files: [expect.objectContaining({ path: "README.md" })] });
    await expect(loadProjectFile({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      filePath: "docs/中文 文件.md",
      fetch,
    })).resolves.toMatchObject({ available: true, path: "README.md" });
    await expect(loadFileReference({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      filePath: "/Users/wing/.codex/sessions/rollout.jsonl",
      line: 292,
      column: 7,
      fetch,
    })).resolves.toMatchObject({ available: true, targetLine: 292 });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:8787/api/local-console/sessions/session%2Fa/workspace-diff",
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      "http://127.0.0.1:8787/api/local-console/sessions/session%2Fa/files",
    );
    expect(String(fetch.mock.calls[2]?.[0])).toContain(
      "/api/local-console/sessions/session%2Fa/files/content?path=docs%2F",
    );
    expect(String(fetch.mock.calls[3]?.[0])).toContain(
      "/api/local-console/sessions/session%2Fa/file-reference?path=%2FUsers%2Fwing",
    );
    expect(String(fetch.mock.calls[3]?.[0])).toContain("line=292&column=7");
  });
});

describe("process output reads", () => {
  it("loads the run-scoped prompt stack through the narrow invocation endpoint", async () => {
    const invocation = {
      status: "available" as const,
      sessionId: "session/a",
      runId: "run/1",
      prompts: {
        system: { status: "recorded" as const, contents: ["SYSTEM"] },
        developer: { status: "not-recorded" as const, contents: [] },
        user: { status: "recorded" as const, contents: ["USER"] },
      },
      metadata: {
        model: "gpt-5",
        effort: "high",
        provider: "openai",
        cliVersion: "1.2.3",
        cwd: "/Users/person/project",
        threadId: "thread-1",
        metadataSource: "rollout" as const,
      },
    };
    const fetch = receiverSensitiveFetch(jsonResponse(invocation));
    await expect(loadProcessDebugInvocation({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: invocation.sessionId,
      runId: invocation.runId,
      fetch,
    })).resolves.toEqual(invocation);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "sessions/session%2Fa/runs/run%2F1/process-debug-invocation",
    );
  });

  it("loads the structured Codex projection with opaque backward and append cursors", async () => {
    const initial = processOutputFixture();
    const fetch = receiverSensitiveFetch(
      jsonResponse(initial),
      jsonResponse({
        events: [],
        appendCursor: "append-next",
        atLatest: true,
        status: "running",
      }),
    );

    await expect(loadProcessOutput({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      runId: "run/1",
      cursor: "previous-page",
      fetch,
    })).resolves.toEqual(initial);
    await expect(loadProcessOutputAppend({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      runId: "run/1",
      appendCursor: "append-current",
      fetch,
    })).resolves.toEqual(expect.objectContaining({ appendCursor: "append-next" }));

    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "sessions/session%2Fa/runs/run%2F1/process-output?cursor=previous-page",
    );
    expect(String(fetch.mock.calls[1]?.[0])).toContain("appendCursor=append-current");
  });

  it("preserves the structured cursor error code for a safe initial reload", async () => {
    const fetch = receiverSensitiveFetch(jsonResponse({
      error: "process output cursor is no longer valid",
      code: "PROCESS_CURSOR_INVALID",
    }, 409));

    await expect(loadProcessOutputAppend({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session-a",
      runId: "run-1",
      appendCursor: "stale",
      fetch,
    })).rejects.toMatchObject({
      status: 409,
      code: "PROCESS_CURSOR_INVALID",
    } satisfies Partial<ProcessOutputRequestError>);
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "reloads authoritative attempt metadata when an append settles as %s",
    async (status) => {
      const initial = processOutputFixture();
      const settled = {
        ...initial,
        status: "settled" as const,
        attempts: [{
          ...initial.attempts[0]!,
          status,
          elapsedMs: 2_000,
          completedAt: "2026-07-23T00:00:02.000Z",
        }],
      };
      const fetch = receiverSensitiveFetch(
        jsonResponse({
          events: [],
          appendCursor: "append-settled",
          atLatest: true,
          status: "settled",
        }),
        jsonResponse(settled),
      );

      await expect(loadProcessOutputUpdate({
        apiBase: "http://127.0.0.1:8787/",
        sessionId: "session/a",
        runId: "run/1",
        appendCursor: "append-current",
        currentStatus: "running",
        fetch,
      })).resolves.toEqual({
        kind: "reload",
        reason: "settled",
        output: settled,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[0]?.[0])).toContain("appendCursor=append-current");
      expect(String(fetch.mock.calls[1]?.[0])).not.toContain("appendCursor=");
    },
  );

  it("falls back to a full process reload when the append cursor becomes invalid", async () => {
    const reloaded = processOutputFixture();
    const fetch = receiverSensitiveFetch(
      jsonResponse({
        error: "process output cursor is no longer valid",
        code: "PROCESS_CURSOR_INVALID",
      }, 409),
      jsonResponse(reloaded),
    );

    await expect(loadProcessOutputUpdate({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      runId: "run/1",
      appendCursor: "stale",
      currentStatus: "running",
      fetch,
    })).resolves.toEqual({
      kind: "reload",
      reason: "cursor-invalid",
      output: reloaded,
    });
  });

  it("does not repeat the metadata reload after the process is already settled", async () => {
    const append = {
      events: [],
      appendCursor: "append-next",
      atLatest: true,
      status: "settled" as const,
    };
    const fetch = receiverSensitiveFetch(jsonResponse(append));

    await expect(loadProcessOutputUpdate({
      apiBase: "http://127.0.0.1:8787/",
      sessionId: "session/a",
      runId: "run/1",
      appendCursor: "append-current",
      currentStatus: "settled",
      fetch,
    })).resolves.toEqual({ kind: "append", append });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps paged history while replacing stale attempt headers after settlement", () => {
    const current = processOutputFixture();
    const staleHeader = {
      key: "run/1:attempt",
      kind: "attempt-header" as const,
      ...current.attempts[0]!,
      engine: "codex" as const,
      model: null,
      effort: null,
      provider: null,
      cliVersion: null,
      metadataSource: "not-recorded" as const,
      threadId: "thread-1",
      elapsedMs: 500,
      completedAt: null,
    };
    current.events = [
      {
        key: "run/1:older",
        kind: "agent-output" as const,
        timestamp: "2026-07-22T23:59:59.000Z",
        protocolType: "response_item · message",
        rawPayload: "{}",
        output: "older page",
      },
      staleHeader,
    ];
    const completedHeader = {
      ...staleHeader,
      status: "completed" as const,
      elapsedMs: 2_000,
      completedAt: "2026-07-23T00:00:02.000Z",
    };
    const incoming = {
      ...current,
      status: "settled" as const,
      attempts: [{
        ...current.attempts[0]!,
        status: "completed" as const,
        elapsedMs: 2_000,
        completedAt: "2026-07-23T00:00:02.000Z",
      }],
      events: [
        completedHeader,
        {
          key: "run/1:newest",
          kind: "agent-output" as const,
          timestamp: "2026-07-23T00:00:02.000Z",
          protocolType: "response_item · message",
          rawPayload: "{}",
          output: "newest page",
        },
      ],
      previousCursor: "incoming-previous",
    };

    const merged = mergeSettledProcessOutput(current, incoming);
    expect(merged.previousCursor).toBe("previous-page");
    expect(merged.events.map((event) => event.key)).toEqual([
      "run/1:older",
      "run/1:attempt",
      "run/1:newest",
    ]);
    expect(merged.events[1]).toMatchObject({
      kind: "attempt-header",
      status: "completed",
      completedAt: "2026-07-23T00:00:02.000Z",
    });
  });

  it("extracts only a run locator belonging to the selected session", () => {
    expect(processOutputRunId("run-output:session-a:run-1", "session-a")).toBe("run-1");
    expect(processOutputRunId("run-output:session-b:run-1", "session-a")).toBeNull();
    expect(processOutputRunId(null, "session-a")).toBeNull();
  });

  it("extracts a child-session process locator independently from the selected parent", () => {
    expect(processOutputLocator(
      "run-output-v2:child%3Asession%2F1:run%3A2026-07-23T02%3A03%3A04Z",
      "parent-session",
    )).toEqual({
      sessionId: "child:session/1",
      runId: "run:2026-07-23T02:03:04Z",
      stepId: null,
    });
    expect(processOutputLocator(
      "run-output-v3:child%3Asession%2F1:message%3A42:run%3Aretry-2",
      "parent-session",
    )).toEqual({
      sessionId: "child:session/1",
      runId: "run:retry-2",
      stepId: "message:42",
    });
  });
});

describe("ConsoleStateActions", () => {
  it("arms the previous session before marking the next session viewed", async () => {
    const armResponse = deferred<Response>();
    const fetch = vi.fn()
      .mockImplementationOnce(() => armResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ session: { sessionId: "session-b" } }));
    const harness = actionHarness({ coordinator: new ConsoleStateCoordinator(), fetch });

    const transition = harness.actions.transitionSessionView("session-a", "session-b");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/sessions/session-a/arm-manual-unread");

    armResponse.resolve(jsonResponse({ session: { sessionId: "session-a" } }));
    await transition;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("/sessions/session-b/viewed");
  });

  it("blocks every selection handler and duplicate mutation while create is pending", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const createResponse = deferred<Response>();
    const refreshResponse = deferred<boolean>();
    const fetch = vi.fn(function (this: unknown) {
      expect(this).toBeUndefined();
      return createResponse.promise;
    });
    const refresh = vi.fn(() => refreshResponse.promise);
    const selectProjectFolder = vi.fn(async () => "/tmp/project-c");
    const harness = actionHarness({ coordinator, fetch, refresh, selectProjectFolder });

    const create = harness.actions.createSessionWithFirstMessage("project-b", "first message");
    expect(coordinator.mutationKind).toBe("create-session");

    harness.actions.selectSession({ projectId: "project-c", sessionId: "session-c" });
    await harness.actions.createSessionWithFirstMessage("project-c", "duplicate");
    await harness.actions.openProject();
    await harness.actions.rebindSessionProject("session-a", "project-c");

    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(selectProjectFolder).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);

    createResponse.resolve(jsonResponse({ session: { sessionId: "session-b" } }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(harness.selection()).toEqual({ projectId: "project-b", sessionId: "session-b" });
    expect(coordinator.isSelectionMutationPending).toBe(true);

    refreshResponse.resolve(true);
    await expect(create).resolves.toEqual({ sessionId: "session-b" });
    expect(coordinator.isSelectionMutationPending).toBe(false);
    expect(harness.mutationKinds).toEqual(["create-session", null]);
  });

  it("reports a failed create without producing a successful session result", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({ error: "create rejected" }, 500));
    const harness = actionHarness({ coordinator, fetch });

    await expect(harness.actions.createSessionWithFirstMessage("project-b", "first message")).resolves.toBeNull();

    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(harness.errors).toEqual(["create rejected"]);
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("sends the selected workspace and Agent team in the same create-session request", async () => {
    const fetch = vi.fn(async () => jsonResponse({ session: { sessionId: "session-b" } }));
    const harness = actionHarness({ coordinator: new ConsoleStateCoordinator(), fetch });

    await harness.actions.createSessionWithFirstMessage(
      "project-b",
      "  first message  ",
      { ownership: "user", id: "my-team" },
      "worktree",
    );

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/sessions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-b",
          initialMessage: "first message",
          agentTeamOwnership: "user",
          agentTeamId: "my-team",
          workspaceMode: "worktree",
        }),
      }),
    );
  });

  it("creates and sends pure attachment messages while clearing only the submitted draft", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ session: { sessionId: "session-b" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: { id: 1 } }, 202));
    const harness = actionHarness({
      coordinator: new ConsoleStateCoordinator(),
      fetch,
      composerValue: "",
      attachmentIds: ["attachment-1"],
    });

    await expect(harness.actions.createSessionWithFirstMessage(
      "project-b",
      "",
      undefined,
      "direct",
      ["attachment-new"],
    )).resolves.toEqual({ sessionId: "session-b" });
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      initialMessage: "",
      attachmentIds: ["attachment-new"],
    });

    await harness.actions.sendMessage();
    expect(JSON.parse((fetch.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      body: "",
      attachmentIds: ["attachment-1"],
    });
    expect(harness.clearComposer).toHaveBeenCalledWith("session-b");
    expect(harness.clearAttachments).toHaveBeenCalledWith("session-b");
  });

  it("deduplicates in-flight sends and blocks selection mutations until the send settles", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn(() => response.promise);
    const coordinator = new ConsoleStateCoordinator();
    const harness = actionHarness({
      coordinator,
      fetch,
      composerValue: "send once",
      attachmentIds: ["attachment-1"],
    });

    const first = harness.actions.sendMessage();
    const duplicate = harness.actions.sendMessage();
    await harness.actions.createSessionWithFirstMessage("project-b", "must wait");

    expect(coordinator.isSendPending).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(jsonResponse({ message: { id: 1 } }, 202));
    await Promise.all([first, duplicate]);
    expect(coordinator.isSendPending).toBe(false);
  });

  it("blocks every selection handler and duplicate mutation while folder picking is pending", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const folderPath = deferred<string | null>();
    const projectResponse = deferred<Response>();
    const fetch = vi.fn(() => projectResponse.promise);
    const selectProjectFolder = vi.fn(() => folderPath.promise);
    const harness = actionHarness({ coordinator, fetch, selectProjectFolder });

    const open = harness.actions.openProject();
    expect(coordinator.mutationKind).toBe("open-project");

    harness.actions.selectSession({ projectId: "project-c", sessionId: "session-c" });
    await harness.actions.createSessionWithFirstMessage("project-c", "duplicate");
    await harness.actions.openProject();
    await harness.actions.rebindSessionProject("session-a", "project-c");

    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(selectProjectFolder).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    folderPath.resolve("/tmp/project-b");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    projectResponse.resolve(jsonResponse({
      project: {
        projectId: "project-b",
        sessions: [
          { sessionId: "hidden-child", parentSessionId: "session-b" },
          { sessionId: "session-b", parentSessionId: null },
        ],
      },
    }));
    await open;

    expect(harness.selection()).toEqual({ projectId: "project-b", sessionId: "session-b" });
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("adds a new project for the new-conversation page without changing the existing selection", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      project: { projectId: "project-c", sessions: [] },
    }));
    const refresh = vi.fn(async () => true);
    const harness = actionHarness({
      coordinator: new ConsoleStateCoordinator(),
      fetch,
      refresh,
      selectProjectFolder: vi.fn(async () => "/tmp/project-c"),
    });

    await expect(harness.actions.addProject(["project-a", "project-b"])).resolves.toEqual({ projectId: "project-c" });

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/projects"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ folderPath: "/tmp/project-c", worktreeMode: false }),
      }),
    );
    expect(refresh).toHaveBeenCalledWith(
      { projectId: "project-a", sessionId: "session-a" },
      expect.objectContaining({ kind: "open-project" }),
    );
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
  });

  it("rejects a folder already represented by a project and keeps the new-conversation selection stable", async () => {
    const refresh = vi.fn(async () => true);
    const harness = actionHarness({
      coordinator: new ConsoleStateCoordinator(),
      fetch: vi.fn(async () => jsonResponse({
        project: { projectId: "project-a", sessions: [{ sessionId: "session-a" }] },
      })),
      refresh,
      selectProjectFolder: vi.fn(async () => "/tmp/project-a"),
    });

    await expect(harness.actions.addProject(["project-a", "project-b"])).resolves.toBeNull();

    expect(harness.errors).toEqual(["该文件夹已被使用，请直接选择已有项目。"]);
    expect(refresh).not.toHaveBeenCalled();
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
  });

  it("blocks every selection handler and duplicate mutation while rebind is pending", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const rebindResponse = deferred<Response>();
    const fetch = vi.fn(() => rebindResponse.promise);
    const selectProjectFolder = vi.fn(async () => "/tmp/project-c");
    const harness = actionHarness({ coordinator, fetch, selectProjectFolder });

    const rebind = harness.actions.rebindSessionProject("session-a", "project-b");
    expect(coordinator.mutationKind).toBe("rebind-session");

    harness.actions.selectSession({ projectId: "project-c", sessionId: "session-c" });
    await harness.actions.createSessionWithFirstMessage("project-c", "duplicate");
    await harness.actions.openProject();
    await harness.actions.rebindSessionProject("session-a", "project-c");

    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(selectProjectFolder).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);

    rebindResponse.resolve(jsonResponse({ session: { sessionId: "session-a" } }));
    await rebind;
    expect(harness.selection()).toEqual({ projectId: "project-b", sessionId: "session-a" });
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("lets the mutation owner preempt an inserted non-owner refresh", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const rebindResponse = deferred<Response>();
    const oldStateResponse = deferred<Response>();
    const targetStateResponse = deferred<Response>();
    const committed: TestState[] = [];
    const fetch = vi.fn()
      .mockImplementationOnce(() => rebindResponse.promise)
      .mockImplementationOnce(() => oldStateResponse.promise)
      .mockImplementationOnce(() => targetStateResponse.promise);
    let selection: ConsoleSelection = { projectId: "project-a", sessionId: "session-a" };
    const refresh = (target: ConsoleSelection, mutationOwner?: Parameters<ConsoleStateCoordinator["beginRefresh"]>[0]) =>
      refreshConsoleState(refreshOptions({
        coordinator,
        fetch,
        committed,
        selection: target,
        mutationOwner: mutationOwner ?? undefined,
        commitSelection: (nextSelection) => {
          selection = nextSelection;
        },
      }));
    const actions = new ConsoleStateActions({
      apiBase: "http://127.0.0.1:8787/",
      coordinator,
      fetch,
      t: zhT,
      getSelection: () => selection,
      commitSelection: (nextSelection) => {
        selection = nextSelection;
      },
      refresh,
      composerValue: "draft",
      clearComposer: vi.fn(),
      setMutationKind: vi.fn(),
      setSending: vi.fn(),
      setError: vi.fn(),
    });

    const rebind = actions.rebindSessionProject("session-a", "project-b");
    expect(coordinator.mutationKind).toBe("rebind-session");

    const insertedOldRefresh = refresh({ projectId: "project-a", sessionId: "session-a" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    rebindResponse.resolve(jsonResponse({ session: { sessionId: "session-a" } }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(selection).toEqual({ projectId: "project-b", sessionId: "session-a" });

    targetStateResponse.resolve(jsonResponse({ selectedProjectId: "project-b", selectedSessionId: "session-a" }));
    await expect(rebind).resolves.toBeUndefined();

    oldStateResponse.resolve(jsonResponse({ selectedProjectId: "project-a", selectedSessionId: "session-a" }));
    await expect(insertedOldRefresh).resolves.toBe(false);
    expect(committed).toEqual([{ selectedProjectId: "project-b", selectedSessionId: "session-a" }]);
    expect(selection).toEqual({ projectId: "project-b", sessionId: "session-a" });
  });

  it("keeps the original selection when folder picking is cancelled or rebind fails", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({ error: "locked" }, 409));
    const selectProjectFolder = vi.fn(async () => null);
    const harness = actionHarness({ coordinator, fetch, selectProjectFolder });

    await harness.actions.openProject();
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(fetch).not.toHaveBeenCalled();

    await harness.actions.rebindSessionProject("session-a", "project-b");
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(harness.errors).toEqual(["locked"]);
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("archives the current session and refreshes the API-selected adjacent session in the same project", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({
      sessionId: "session-a",
      projectId: "project-a",
      selectedSessionId: "session-b",
    }));
    const refresh = vi.fn(async () => true);
    const harness = actionHarness({ coordinator, fetch, refresh });

    await harness.actions.archiveSession("session-a", "project-a");

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/sessions/session-a/archive"),
      { method: "POST" },
    );
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-b" });
    expect(refresh).toHaveBeenCalledWith(
      { projectId: "project-a", sessionId: "session-b" },
      expect.objectContaining({ kind: "archive-session" }),
    );
    expect(harness.mutationKinds).toEqual(["archive-session", null]);
  });

  it("keeps selection when the archive API rejects a running session", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({
      error: "Running sessions cannot be archived",
      code: "SESSION_HAS_RUNNING_AGENT",
    }, 409));
    const harness = actionHarness({ coordinator, fetch });

    await harness.actions.archiveSession("session-a", "project-a");

    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
    expect(harness.errors).toEqual(["Running sessions cannot be archived"]);
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("persists a complete project order and refreshes without changing selection", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({
      projects: [{ projectId: "project-b" }, { projectId: "project-a" }],
    }));
    const refresh = vi.fn(async () => true);
    const harness = actionHarness({ coordinator, fetch, refresh });

    await expect(harness.actions.reorderProjects(["project-b", "project-a"])).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/local-console/projects/order"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ projectIds: ["project-b", "project-a"] }),
      }),
    );
    expect(refresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "session-a" });
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
  });

  it("commits confirmed sidebar metadata before a failed follow-up refresh and rejects stale writes", async () => {
    const confirmedSession = {
      sessionId: "session-a",
      projectId: "project-a",
      title: "新标题",
      titleRevision: 1,
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ session: confirmedSession }))
      .mockResolvedValueOnce(jsonResponse({
        error: "对话名称已经变化，请重新打开重命名",
        code: "SESSION_SIDEBAR_STATE_STALE",
      }, 409));
    const refresh = vi.fn(async () => false);
    const commitSessionMetadata = vi.fn();
    const harness = actionHarness({
      coordinator: new ConsoleStateCoordinator(),
      fetch,
      refresh,
      commitSessionMetadata,
    });

    await expect(harness.actions.renameSession(
      { id: "session-a", titleRevision: 0 },
      "新标题",
    )).resolves.toBeUndefined();
    expect(commitSessionMetadata).toHaveBeenCalledWith(confirmedSession);
    expect(refresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "session-a" });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/session-a/title"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "新标题", expectedTitleRevision: 0 }),
      }),
    );

    await expect(harness.actions.renameSession(
      { id: "session-a", titleRevision: 0 },
      "陈旧标题",
    )).rejects.toThrow("对话名称已经变化");
    expect(commitSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("reports a project reorder failure and lets the sidebar restore server order", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({ error: "stale project order" }, 409));
    const harness = actionHarness({ coordinator, fetch });

    await expect(harness.actions.reorderProjects(["project-b", "project-a"])).resolves.toBe(false);
    expect(harness.errors).toEqual(["stale project order"]);
    expect(harness.selection()).toEqual({ projectId: "project-a", sessionId: "session-a" });
  });

  it("keeps the API-confirmed target selection when the follow-up refresh fails", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const fetch = vi.fn(async () => jsonResponse({ session: { sessionId: "session-a" } }));
    const refresh = vi.fn(async () => false);
    const harness = actionHarness({ coordinator, fetch, refresh, composerValue: "draft" });

    await harness.actions.rebindSessionProject("session-a", "project-b");

    expect(harness.selection()).toEqual({ projectId: "project-b", sessionId: "session-a" });
    expect(refresh).toHaveBeenCalledWith(
      { projectId: "project-b", sessionId: "session-a" },
      expect.objectContaining({ kind: "rebind-session" }),
    );
    expect(harness.clearComposer).not.toHaveBeenCalled();
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });

  it("does not send when the send handler is called directly during rebind", async () => {
    const coordinator = new ConsoleStateCoordinator();
    const rebindResponse = deferred<Response>();
    const fetch = vi.fn(() => rebindResponse.promise);
    const harness = actionHarness({ coordinator, fetch, composerValue: "hello" });

    const rebind = harness.actions.rebindSessionProject("session-a", "project-b");
    await harness.actions.sendMessage();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(harness.sending).toEqual([]);
    rebindResponse.resolve(jsonResponse({ session: { sessionId: "session-a" } }));
    await rebind;
  });

  it("drives session workspace and team changes through their loopback endpoints then refreshes", async () => {
    const fetch = vi.fn(async () => jsonResponse({ session: { sessionId: "session/a" } }));
    const refresh = vi.fn(async () => true);
    const harness = actionHarness({ coordinator: new ConsoleStateCoordinator(), fetch, refresh });

    await harness.actions.changeSessionWorkspace("session/a", "worktree");
    await harness.actions.changeSessionTeam("session/a", { ownership: "user", id: "marketing" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/session%2Fa/workspace"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ workspaceMode: "worktree" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      new URL("http://127.0.0.1:8787/api/local-console/sessions/session%2Fa/team"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ agentTeamOwnership: "user", agentTeamId: "marketing" }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith({ projectId: "project-a", sessionId: "session-a" });
  });

  it("only lets the mutation token owner release the pending gate", () => {
    const coordinator = new ConsoleStateCoordinator();
    const owner = coordinator.beginSelectionMutation("create-session");
    expect(owner).not.toBeNull();
    expect(coordinator.beginSelectionMutation("open-project")).toBeNull();
    expect(coordinator.beginSelectionMutation("rebind-session")).toBeNull();
    expect(coordinator.beginSelectionMutation("archive-session")).toBeNull();
    expect(coordinator.endSelectionMutation({ id: 999, kind: "create-session" })).toBe(false);
    expect(coordinator.isSelectionMutationPending).toBe(true);
    expect(coordinator.endSelectionMutation(owner!)).toBe(true);
    expect(coordinator.isSelectionMutationPending).toBe(false);
  });
});

function processOutputFixture(): OperatorProcessOutput {
  return {
    sessionId: "session/a",
    requestedRunId: "run/1",
    role: "dev",
    status: "running" as const,
    unavailableReason: null,
    attempts: [{
      runId: "run/1",
      attempt: 1,
      role: "dev",
      engine: "codex",
      model: null,
      effort: null,
      provider: null,
      cliVersion: null,
      metadataSource: "not-recorded",
      threadId: "thread-1",
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "running" as const,
      elapsedMs: 0,
      completedAt: null,
    }],
    events: [{
      key: "run/1:agent",
      kind: "agent-output",
      timestamp: "2026-07-23T00:00:01.000Z",
      protocolType: "response_item · message",
      rawPayload: "{}",
      output: "正在检查。",
    }],
    previousCursor: "previous-page",
    appendCursor: "append-current",
    atLatest: true,
  };
}

function refreshOptions(input: {
  coordinator: ConsoleStateCoordinator;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  committed: TestState[];
  selection?: ConsoleSelection;
  mutationOwner?: Parameters<ConsoleStateCoordinator["beginRefresh"]>[0];
  commitSelection?: (selection: ConsoleSelection) => void;
}) {
  return {
    apiBase: "http://127.0.0.1:8787/",
    selection: input.selection ?? { projectId: "project-a", sessionId: "session-a" },
    coordinator: input.coordinator,
    fetch: input.fetch,
    t: zhT,
    readSelection: (state: TestState) => ({
      projectId: state.selectedProjectId,
      sessionId: state.selectedSessionId,
    }),
    commitState: (state: TestState) => input.committed.push(state),
    commitSelection: input.commitSelection ?? vi.fn(),
    setError: vi.fn(),
    mutationOwner: input.mutationOwner ?? undefined,
  };
}

function actionHarness(input: {
  coordinator: ConsoleStateCoordinator;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  refresh?: (
    selection: ConsoleSelection,
    mutationOwner?: Parameters<ConsoleStateCoordinator["beginRefresh"]>[0],
  ) => Promise<boolean>;
  selectProjectFolder?: () => Promise<string | null>;
  composerValue?: string;
  attachmentIds?: string[];
  commitSessionMetadata?: (
    session: import("@moebius/console-ui").OperatorSession,
  ) => void;
}) {
  let selection: ConsoleSelection = { projectId: "project-a", sessionId: "session-a" };
  const mutationKinds: Array<SelectionMutationKind | null> = [];
  const errors: string[] = [];
  const sending: boolean[] = [];
  const clearComposer = vi.fn();
  const clearAttachments = vi.fn();
  const actions = new ConsoleStateActions({
    apiBase: "http://127.0.0.1:8787/",
    coordinator: input.coordinator,
    fetch: input.fetch,
    t: zhT,
    getSelection: () => selection,
    commitSelection: (nextSelection) => {
      selection = nextSelection;
    },
    refresh: input.refresh ?? (async () => true),
    composerValue: input.composerValue ?? "draft",
    clearComposer,
    getAttachmentIds: () => input.attachmentIds ?? [],
    clearAttachments,
    setMutationKind: (kind) => mutationKinds.push(kind),
    setSending: (value) => sending.push(value),
    setError: (error) => errors.push(error),
    commitSessionMetadata: input.commitSessionMetadata,
    selectProjectFolder: input.selectProjectFolder,
  });
  return {
    actions,
    clearComposer,
    clearAttachments,
    errors,
    mutationKinds,
    selection: () => selection,
    sending,
  };
}

function receiverSensitiveFetch(...responses: Response[]) {
  let nextResponse = 0;
  return vi.fn(function (
    this: unknown,
    _input: string | URL | Request,
    _init?: RequestInit,
  ) {
    expect(this).toBeUndefined();
    const response = responses[nextResponse];
    nextResponse += 1;
    if (response === undefined) {
      return Promise.reject(new Error("unexpected fetch call"));
    }
    return Promise.resolve(response);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
