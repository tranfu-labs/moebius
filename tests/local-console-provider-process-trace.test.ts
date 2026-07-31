import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LocalRunExecutionContextFact } from "../src/local-console/execution-context.js";
import {
  readProviderTraceContext,
  readProviderTracePage,
  resolveProviderTrace,
  type ProviderTraceLink,
} from "../src/local-console/provider-process-trace.js";
import {
  loadLocalProcessHistoryPage,
  ProcessCursorError,
} from "../src/local-console/process-history.js";

describe("provider-native process traces", () => {
  it("locates a Claude transcript by exact session id and projects thinking/tools/results", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-trace-"));
    const projectsRoot = path.join(root, "projects");
    const cwd = path.join(root, "workspace");
    const sessionId = "9c67bce8-c673-4be7-99f6-48777e06a68d";
    const transcript = path.join(projectsRoot, "private-project-key", `${sessionId}.jsonl`);
    const sidecar = path.join(
      projectsRoot,
      "private-project-key",
      sessionId,
      "tool-results",
      "result.txt",
    );
    const outside = path.join(root, "outside-result.txt");
    try {
      await fs.mkdir(path.dirname(transcript), { recursive: true });
      await fs.mkdir(path.dirname(sidecar), { recursive: true });
      await fs.writeFile(sidecar, "CLAUDE_SIDECAR_RESULT_MARKER");
      await fs.writeFile(outside, "MUST_NOT_LEAK");
      await fs.writeFile(transcript, jsonl([
        claudeRecord(sessionId, cwd, "user", [
          { type: "text", text: "inspect the fixture" },
        ]),
        claudeRecord(sessionId, cwd, "assistant", [
          {
            type: "thinking",
            thinking: "",
            signature: "CLAUDE_OPAQUE_SIGNATURE",
          },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file: "fixture.txt" } },
        ]),
        {
          ...claudeRecord(sessionId, cwd, "user", [
            { type: "tool_result", tool_use_id: "tool-1", content: "TRUNCATED_INLINE" },
          ]),
          toolUseResult: { persistedOutputPath: sidecar },
        },
        {
          ...claudeRecord(sessionId, cwd, "user", [
            { type: "tool_result", tool_use_id: "tool-2", content: "OUTSIDE_INLINE" },
          ]),
          toolUseResult: { persistedOutputPath: outside },
        },
      ]));

      const resolution = await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: executionContext("claude", cwd),
        options: { claudeProjectsRoot: projectsRoot },
      });
      expect(resolution).toMatchObject({
        status: "available",
        engine: "claude",
        externalSessionId: sessionId,
      });
      if (resolution.status !== "available" || resolution.engine !== "claude") {
        return;
      }

      const page = await readProviderTracePage({
        resolution,
        runId: "run-1",
        maxBytes: 96,
        maxEvents: 1,
      });
      const collected = [...page.events];
      let previous = page.previousOffset;
      while (previous !== null) {
        const older = await readProviderTracePage({
          resolution,
          runId: "run-1",
          endOffset: previous,
          expectedIdentity: page.identity,
          minimumSize: page.identity.size,
          maxBytes: 96,
          maxEvents: 1,
        });
        collected.unshift(...older.events);
        previous = older.previousOffset;
      }
      expect(collected).toEqual(expect.arrayContaining([
        expect.objectContaining({
          engine: "claude",
          kind: "thinking",
          thinking: "",
        }),
        expect.objectContaining({
          engine: "claude",
          kind: "tool",
          phase: "started",
          name: "Read",
          callId: "tool-1",
        }),
        expect.objectContaining({
          engine: "claude",
          kind: "tool",
          phase: "completed",
          callId: "tool-1",
          output: "CLAUDE_SIDECAR_RESULT_MARKER",
        }),
        expect.objectContaining({
          engine: "claude",
          kind: "tool",
          phase: "completed",
          callId: "tool-2",
          output: "[Claude tool result sidecar unavailable]",
        }),
      ]));
      expect(JSON.stringify(collected)).not.toContain("CLAUDE_OPAQUE_SIGNATURE");
      expect(JSON.stringify(collected)).not.toContain("MUST_NOT_LEAK");
      const invocation = await readProviderTraceContext(resolution);
      expect(invocation).toMatchObject({
        sections: expect.arrayContaining([
          expect.objectContaining({ key: "user", status: "recorded" }),
        ]),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not substitute another Claude session from the same user home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-trace-"));
    const projectsRoot = path.join(root, "projects");
    const cwd = path.join(root, "workspace");
    const linked = "87de9b82-b180-4dc4-b8ac-f497d95f339e";
    const other = "9a179f42-30ed-46a4-bbc5-a3a5d39ee021";
    try {
      await fs.mkdir(path.join(projectsRoot, "one"), { recursive: true });
      await fs.writeFile(
        path.join(projectsRoot, "one", `${other}.jsonl`),
        jsonl([claudeRecord(other, cwd, "assistant", [{ type: "text", text: "newer" }])]),
      );
      expect(await resolveProviderTrace({
        link: traceLink("claude", linked),
        context: executionContext("claude", cwd),
        options: { claudeProjectsRoot: projectsRoot },
      })).toEqual({
        status: "unavailable",
        engine: "claude",
        reason: "not-found",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses inherited non-empty CLAUDE_CONFIG_DIR before the real-home default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-root-"));
    const configured = path.join(root, "configured");
    const home = path.join(root, "home");
    const cwd = path.join(root, "workspace");
    const sessionId = "1a648ad1-a4d9-473e-bf44-f2cc6eb505e5";
    const configuredTranscript = path.join(
      configured,
      "projects",
      "configured-project",
      `${sessionId}.jsonl`,
    );
    const homeTranscript = path.join(
      home,
      ".claude",
      "projects",
      "home-project",
      `${sessionId}.jsonl`,
    );
    try {
      await fs.mkdir(path.dirname(configuredTranscript), { recursive: true });
      await fs.mkdir(path.dirname(homeTranscript), { recursive: true });
      await fs.writeFile(
        configuredTranscript,
        jsonl([claudeRecord(sessionId, cwd, "assistant", [{ type: "text", text: "configured" }])]),
      );
      await fs.writeFile(
        homeTranscript,
        jsonl([claudeRecord(sessionId, path.join(root, "wrong"), "assistant", [{ type: "text", text: "home" }])]),
      );
      const configuredResolution = await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: executionContext("claude", cwd),
        options: {
          env: { CLAUDE_CONFIG_DIR: configured },
          homeDir: home,
        },
      });
      expect(configuredResolution).toMatchObject({
        status: "available",
        engine: "claude",
        file: { filePath: await fs.realpath(configuredTranscript) },
      });

      const defaultResolution = await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: executionContext("claude", cwd),
        options: {
          env: { CLAUDE_CONFIG_DIR: "  " },
          homeDir: home,
        },
      });
      expect(defaultResolution).toMatchObject({
        status: "unavailable",
        engine: "claude",
        reason: "context-mismatch",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for duplicate Claude candidates and cwd mismatch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-trace-"));
    const projectsRoot = path.join(root, "projects");
    const cwd = path.join(root, "workspace");
    const sessionId = "7bea2de0-7403-44b6-9468-efb2d998579a";
    try {
      for (const project of ["one", "two"]) {
        await fs.mkdir(path.join(projectsRoot, project), { recursive: true });
        await fs.writeFile(
          path.join(projectsRoot, project, `${sessionId}.jsonl`),
          jsonl([claudeRecord(sessionId, cwd, "assistant", [{ type: "text", text: project }])]),
        );
      }
      expect(await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: executionContext("claude", cwd),
        options: { claudeProjectsRoot: projectsRoot },
      })).toMatchObject({ status: "unavailable", reason: "duplicate" });

      await fs.rm(path.join(projectsRoot, "two"), { recursive: true });
      expect(await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: executionContext("claude", path.join(root, "different-workspace")),
        options: { claudeProjectsRoot: projectsRoot },
      })).toMatchObject({ status: "unavailable", reason: "context-mismatch" });
      expect(await resolveProviderTrace({
        link: traceLink("claude", sessionId),
        context: {
          ...executionContext("claude", cwd),
          sourceMessageId: 2,
        },
        options: { claudeProjectsRoot: projectsRoot },
      })).toMatchObject({ status: "unavailable", reason: "context-mismatch" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rebases a Kimi index row with an old managed-home prefix onto source home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-trace-"));
    const sourceHome = path.join(root, "source-home");
    const cwd = path.join(root, "workspace");
    const sessionId = "session_4c3f6e8a-21b6-4de2-86de-9427779b7fbc";
    const suffix = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 12);
    const workDirKey = `wd_workspace_${suffix}`;
    const wire = path.join(
      sourceHome,
      "sessions",
      workDirKey,
      sessionId,
      "agents",
      "main",
      "wire.jsonl",
    );
    const blobId = "a".repeat(64);
    const escapedBlobId = "b".repeat(64);
    const blob = path.join(path.dirname(wire), "blobs", blobId);
    const escapedBlob = path.join(path.dirname(wire), "blobs", escapedBlobId);
    const outsideBlob = path.join(root, "outside-blob");
    try {
      await fs.mkdir(path.dirname(wire), { recursive: true });
      await fs.mkdir(path.dirname(blob), { recursive: true });
      await fs.writeFile(blob, "binary-placeholder");
      await fs.writeFile(outsideBlob, "MUST_NOT_READ");
      await fs.symlink(outsideBlob, escapedBlob);
      await fs.writeFile(path.join(sourceHome, "session_index.jsonl"), jsonl([{
        sessionId,
        workDir: cwd,
        sessionDir: path.join(root, "deleted-managed-home", "sessions", workDirKey, sessionId),
      }]));
      await fs.writeFile(wire, jsonl([
        {
          type: "config.update",
          time: 1_785_369_600_000,
          systemPrompt: "KIMI_SYSTEM",
          modelAlias: "kimi-code/k3",
          thinkingEffort: "high",
        },
        { type: "turn.prompt", time: "2026-07-30T00:00:01.000Z", input: "KIMI_TURN" },
        {
          type: "context.append_loop_event",
          time: 1_785_369_602_000,
          event: { type: "content.part", part: { type: "think", think: "KIMI_THINKING_MARKER" } },
        },
        {
          type: "context.append_loop_event",
          time: "2026-07-30T00:00:03.000Z",
          event: { type: "tool.call", name: "ReadFile", toolCallId: "kimi-tool", args: { path: "fixture" } },
        },
        {
          type: "context.append_loop_event",
          time: "2026-07-30T00:00:04.000Z",
          event: {
            type: "tool.result",
            toolCallId: "kimi-tool",
            result: {
              output: [
                "KIMI_RESULT_MARKER",
                { type: "imageUrl", imageUrl: { url: `blobref:image/png;${blobId}` } },
                { type: "imageUrl", imageUrl: { url: `blobref:image/png;${escapedBlobId}` } },
                { type: "imageUrl", imageUrl: { url: "blobref:image/png;../../escape" } },
              ],
            },
          },
        },
        {
          type: "context.append_loop_event",
          time: "2026-07-30T00:00:05.000Z",
          event: {
            type: "future.encrypted",
            encrypted_content: "KIMI_OPAQUE_MARKER",
          },
        },
      ]));

      const resolution = await resolveProviderTrace({
        link: traceLink("kimi", sessionId),
        context: executionContext("kimi", cwd),
        options: { kimiSourceHome: sourceHome },
      });
      expect(resolution).toMatchObject({ status: "available", engine: "kimi" });
      if (resolution.status !== "available" || resolution.engine !== "kimi") {
        return;
      }
      expect("file" in resolution ? resolution.file.filePath : "").toBe(await fs.realpath(wire));
      const page = await readProviderTracePage({ resolution, runId: "run-1" });
      expect(page.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          engine: "kimi",
          kind: "thinking",
          thinking: "KIMI_THINKING_MARKER",
          timestamp: "2026-07-30T00:00:02.000Z",
        }),
        expect.objectContaining({
          engine: "kimi",
          kind: "tool",
          phase: "started",
          callId: "kimi-tool",
        }),
        expect.objectContaining({
          engine: "kimi",
          kind: "tool",
          phase: "completed",
          output: expect.stringContaining("KIMI_RESULT_MARKER"),
        }),
        expect.objectContaining({
          engine: "kimi",
          kind: "unsupported-debug",
          rawPayload: expect.not.stringContaining("KIMI_OPAQUE_MARKER"),
        }),
      ]));
      const completed = page.events.find((event) =>
        event.kind === "tool" && event.phase === "completed");
      expect(JSON.stringify(completed)).toContain(`blobref:image/png;${blobId}`);
      expect(JSON.stringify(completed)).toContain("[Kimi blob unavailable]");
      expect(await readProviderTraceContext(resolution)).toMatchObject({
        sections: expect.arrayContaining([
          expect.objectContaining({ key: "system", contents: ["KIMI_SYSTEM"] }),
          expect.objectContaining({ key: "turn", contents: ["KIMI_TURN"] }),
        ]),
        metadata: expect.objectContaining({
          model: "kimi-code/k3",
          effort: "high",
        }),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a Kimi workDirKey whose hash does not match immutable cwd", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-trace-"));
    const sourceHome = path.join(root, "source-home");
    const cwd = path.join(root, "workspace");
    const sessionId = "session_a8564eb2-1aa2-436d-b0e8-c04436853419";
    const workDirKey = "wd_workspace_000000000000";
    try {
      await fs.mkdir(path.join(sourceHome, "sessions"), { recursive: true });
      await fs.writeFile(path.join(sourceHome, "session_index.jsonl"), jsonl([{
        sessionId,
        workDir: cwd,
        sessionDir: path.join(root, "old", workDirKey, "session_wrong"),
      }]));
      expect(await resolveProviderTrace({
        link: traceLink("kimi", sessionId),
        context: executionContext("kimi", cwd),
        options: { kimiSourceHome: sourceHome },
      })).toEqual({
        status: "unavailable",
        engine: "kimi",
        reason: "malformed",
      });

      await fs.writeFile(path.join(sourceHome, "session_index.jsonl"), jsonl([{
        sessionId,
        workDir: cwd,
        sessionDir: path.join(root, "old", workDirKey, sessionId),
      }]));
      expect(await resolveProviderTrace({
        link: traceLink("kimi", sessionId),
        context: executionContext("kimi", cwd),
        options: { kimiSourceHome: sourceHome },
      })).toEqual({
        status: "unavailable",
        engine: "kimi",
        reason: "context-mismatch",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("aggregates two resume attempts from one Claude session without inventing event ranges", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-history-"));
    const projectsRoot = path.join(root, "projects");
    const cwd = path.join(root, "workspace");
    const sessionId = "0eb4f920-ad40-488a-ae20-c5fa7a496cb4";
    const factLog = path.join(root, "session.jsonl");
    try {
      await fs.mkdir(path.join(projectsRoot, "project"), { recursive: true });
      await fs.writeFile(
        path.join(projectsRoot, "project", `${sessionId}.jsonl`),
        jsonl([
          claudeRecord(sessionId, cwd, "assistant", [
            { type: "thinking", thinking: "SHARED_SESSION_THINKING" },
            { type: "text", text: "SHARED_SESSION_OUTPUT" },
          ]),
        ]),
      );
      const contextA = { ...executionContext("claude", cwd), runId: "run-a" };
      const contextB = { ...executionContext("claude", cwd), runId: "run-b" };
      const linkA = { ...traceLink("claude", sessionId), runId: "run-a" };
      const linkB = {
        ...traceLink("claude", sessionId),
        runId: "run-b",
        startedAt: "2026-07-30T00:01:00.000Z",
      };
      await fs.writeFile(factLog, jsonl([
        fact("context-a", "run_execution_context", contextA),
        fact("link-a", "execution_session_link", linkA),
        fact("context-b", "run_execution_context", contextB),
        fact("link-b", "execution_session_link", linkB),
      ]));

      const page = await loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-b",
        sessionFactLogPath: factLog,
        messages: [],
        activeRunIds: new Set(),
        trace: { claudeProjectsRoot: projectsRoot },
        maxBytes: 1_000_000,
        maxEvents: 100,
      });
      expect(page.status).toBe("settled");
      expect(page.attempts).toEqual([
        expect.objectContaining({
          runId: "run-a",
          engine: "claude",
          externalSessionId: sessionId,
        }),
        expect.objectContaining({
          runId: "run-b",
          engine: "claude",
          externalSessionId: sessionId,
        }),
      ]);
      expect(page.events.filter((event) =>
        event.kind === "thinking" && event.thinking === "SHARED_SESSION_THINKING"))
        .toHaveLength(2);

      const firstPage = await loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-b",
        sessionFactLogPath: factLog,
        messages: [],
        activeRunIds: new Set(),
        trace: { claudeProjectsRoot: projectsRoot },
        maxBytes: 1_000_000,
        maxEvents: 1,
      });
      expect(firstPage.previousCursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(firstPage.previousCursor!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      const tampered = Buffer.from(JSON.stringify({
        ...decoded,
        engine: "kimi",
      }), "utf8").toString("base64url");
      await expect(loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-b",
        sessionFactLogPath: factLog,
        messages: [],
        activeRunIds: new Set(),
        cursor: tampered,
        trace: { claudeProjectsRoot: projectsRoot },
      })).rejects.toBeInstanceOf(ProcessCursorError);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails the step closed when persisted attempts mix providers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-mixed-provider-history-"));
    const factLog = path.join(root, "session.jsonl");
    const cwd = path.join(root, "workspace");
    const claude = "2cda4e3c-ee15-4b97-abaa-11045f34d4d3";
    const kimi = "session_f9afcc22-fb75-4f6d-9f50-d24f2c6cd024";
    try {
      await fs.writeFile(factLog, jsonl([
        fact("context-claude", "run_execution_context", {
          ...executionContext("claude", cwd),
          runId: "run-claude",
        }),
        fact("link-claude", "execution_session_link", {
          ...traceLink("claude", claude),
          runId: "run-claude",
        }),
        fact("context-kimi", "run_execution_context", {
          ...executionContext("kimi", cwd),
          runId: "run-kimi",
        }),
        fact("link-kimi", "execution_session_link", {
          ...traceLink("kimi", kimi),
          runId: "run-kimi",
          startedAt: "2026-07-30T00:01:00.000Z",
        }),
      ]));
      await expect(loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-kimi",
        sessionFactLogPath: factLog,
        messages: [],
        activeRunIds: new Set(),
      })).resolves.toMatchObject({
        status: "unavailable",
        unavailableReason: "identity-invalid",
        events: [],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function traceLink(
  engine: "claude" | "kimi",
  externalSessionId: string,
): ProviderTraceLink {
  return {
    sessionId: "session-a",
    runId: "run-1",
    sourceMessageId: 1,
    role: "dev",
    engine,
    externalSessionId,
    contextFingerprint: "context-fingerprint",
    startedAt: "2026-07-30T00:00:00.000Z",
  };
}

function executionContext(
  engine: "claude" | "kimi",
  cwd: string,
): LocalRunExecutionContextFact {
  return {
    sessionId: "session-a",
    runId: "run-1",
    sourceMessageId: 1,
    role: "dev",
    engine,
    profile: { cli: engine, model: "", effort: "" },
    profileFingerprint: "profile-fingerprint",
    agentIdentityFingerprint: "agent-fingerprint",
    contextFingerprint: "context-fingerprint",
    workspace: {
      cwd: path.resolve(cwd),
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [],
    recordedAt: "2026-07-30T00:00:00.000Z",
  };
}

function claudeRecord(
  sessionId: string,
  cwd: string,
  role: "user" | "assistant",
  content: unknown[],
): Record<string, unknown> {
  return {
    type: role,
    sessionId,
    cwd: path.resolve(cwd),
    isSidechain: false,
    timestamp: "2026-07-30T00:00:00.000Z",
    version: "2.1.220",
    message: {
      role,
      model: role === "assistant" ? "claude-sonnet" : undefined,
      content,
    },
  };
}

function jsonl(values: unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function fact(eventId: string, type: string, payload: unknown): unknown {
  return {
    version: 1,
    eventId,
    sessionId: "session-a",
    type,
    recordedAt: "2026-07-30T00:00:00.000Z",
    payload,
    messageUpserts: [],
  };
}
