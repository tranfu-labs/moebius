import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  projectLocalConsoleMemberIdentities,
  resolveLocalConsoleMemberName,
} from "../src/local-console/member-identity.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console member identity projection", () => {
  it("projects ordered custom names and finitely degrades malformed identities", () => {
    const identities = projectLocalConsoleMemberIdentities({
      members: [
        member("plan-supervisor", "方案监督者"),
        member("plan-executor", "方案执行者"),
        { name: "legacy-reviewer", agentMarkdown: "# 旧格式审查者\n\n负责审查。\n" },
        { name: "empty-name", agentMarkdown: "---\ndisplay_name: \"\"\ndescription: 缺失名称\n---\n\nsecret" },
        { name: "bad-type", agentMarkdown: "---\ndisplay_name: [bad]\ndescription: 非字符串\n---\n\nsecret" },
        { name: "broken-yaml", agentMarkdown: "---\ndisplay_name: [\n---\n\nsecret" },
        { name: "chosen-face", agentMarkdown: "---\ndisplay_name: 换过脸\ndescription: 测试成员\nportrait_id: cat-12\n---\n\nsecret" },
        { name: "null-face", agentMarkdown: "---\ndisplay_name: 空脸\ndescription: 测试成员\nportrait_id: null\n---\n\nsecret" },
        { name: "bad-face", agentMarkdown: "---\ndisplay_name: 坏脸\ndescription: 测试成员\nportrait_id: [bad]\n---\n\nsecret" },
        { name: "record-face", agentMarkdown: "---\ndisplay_name: 记录脸\ndescription: 测试成员\n---\n\nsecret", portraitId: "cat-21" },
        { name: "record-null", agentMarkdown: "---\ndisplay_name: 记录空\ndescription: 测试成员\nportrait_id: cat-07\n---\n\nsecret", portraitId: null },
      ],
    });

    expect(identities).toEqual([
      { slug: "plan-supervisor", displayName: "方案监督者" },
      { slug: "plan-executor", displayName: "方案执行者" },
      { slug: "legacy-reviewer", displayName: "旧格式审查者" },
      { slug: "empty-name", displayName: "" },
      { slug: "bad-type", displayName: "" },
      { slug: "broken-yaml", displayName: "" },
      { slug: "chosen-face", displayName: "换过脸", portraitId: "cat-12" },
      { slug: "null-face", displayName: "空脸" },
      { slug: "bad-face", displayName: "坏脸" },
      // The app record in the snapshot wins; an explicit null clears a stale legacy field.
      { slug: "record-face", displayName: "记录脸", portraitId: "cat-21" },
      { slug: "record-null", displayName: "记录空" },
    ]);
    expect(resolveLocalConsoleMemberName("empty-name", identities)).toBe("@empty-name");
    expect(resolveLocalConsoleMemberName("missing", identities)).toBe("成员未知");
    expect(JSON.stringify(identities)).not.toContain("secret");
  });

  it("restores a persisted custom-team session without rewriting JSONL or SQLite rows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-member-identity-"));
    roots.push(root);
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath,
      sessionLogRoot: path.join(root, "sessions"),
    });
    const liveTeamLoader = vi.fn(async () => {
      throw new Error("state reads must not consult the live team");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
      loadAgentTeamSnapshot: liveTeamLoader,
      storeTimeoutMs: 2_000,
    });
    servers.push(started);

    const sessionId = "persisted-custom-team";
    await store.createSession({
      sessionId,
      title: "旧会话",
      agentTeamOwnership: "user",
      agentTeamId: "deleted-team",
      agentTeamSnapshot: {
        members: [
          member("plan-supervisor", "方案监督者", "SUPERVISOR_PRIVATE_RULES"),
          member("plan-executor", "方案执行者", "EXECUTOR_PRIVATE_RULES"),
        ],
      },
      now: "2026-07-25T00:00:00.000Z",
    });
    await store.recordDetachedAgentResponse({
      sessionId,
      role: "plan-supervisor",
      body: "监督结论",
      runId: "run-supervisor",
      runDir: path.join(root, "runs", "supervisor"),
      now: "2026-07-25T00:00:01.000Z",
    });
    await store.recordDetachedAgentResponse({
      sessionId,
      role: "plan-executor",
      body: "执行结论",
      runId: "run-executor",
      runDir: path.join(root, "runs", "executor"),
      now: "2026-07-25T00:00:02.000Z",
    });

    const logPath = store.getSessionFactLogPath(sessionId);
    const beforeLog = await fileFingerprint(logPath);
    const observer = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const beforeVersion = observer.prepare("PRAGMA data_version").get();
      const beforeMembers = observer.prepare(
        "SELECT * FROM session_agent_team_members WHERE session_id = ? ORDER BY slot, sort_order, member_name",
      ).all(sessionId);
      const beforeMessages = observer.prepare(
        "SELECT * FROM session_messages WHERE session_id = ? ORDER BY id",
      ).all(sessionId);

      const stateResponse = await fetch(new URL(
        `/api/local-console/state?projectId=local&sessionId=${encodeURIComponent(sessionId)}`,
        started.url,
      ));
      const viewResponse = await fetch(new URL(
        `/api/local-console/sessions/${encodeURIComponent(sessionId)}/view`,
        started.url,
      ));
      expect(stateResponse.status).toBe(200);
      expect(viewResponse.status).toBe(200);
      const state = await stateResponse.json() as Record<string, unknown>;
      const view = await viewResponse.json() as Record<string, unknown>;
      const expectedIdentities = [
        { slug: "plan-supervisor", displayName: "方案监督者" },
        { slug: "plan-executor", displayName: "方案执行者" },
      ];
      expect(state.memberIdentities).toEqual(expectedIdentities);
      expect(view.memberIdentities).toEqual(expectedIdentities);
      expect(state.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "plan-supervisor", body: "监督结论" }),
        expect.objectContaining({ role: "plan-executor", body: "执行结论" }),
      ]));

      const serializedResponses = JSON.stringify({ state, view });
      expect(serializedResponses).not.toContain("agentMarkdown");
      expect(serializedResponses).not.toContain("SUPERVISOR_PRIVATE_RULES");
      expect(serializedResponses).not.toContain("EXECUTOR_PRIVATE_RULES");
      expect(await fileFingerprint(logPath)).toEqual(beforeLog);
      expect(observer.prepare("PRAGMA data_version").get()).toEqual(beforeVersion);
      expect(observer.prepare(
        "SELECT * FROM session_agent_team_members WHERE session_id = ? ORDER BY slot, sort_order, member_name",
      ).all(sessionId)).toEqual(beforeMembers);
      expect(observer.prepare(
        "SELECT * FROM session_messages WHERE session_id = ? ORDER BY id",
      ).all(sessionId)).toEqual(beforeMessages);
      expect(liveTeamLoader).not.toHaveBeenCalled();
    } finally {
      observer.close();
    }
  });
});

function member(slug: string, displayName: string, privateBody = "PRIVATE_PERSONA") {
  return {
    name: slug,
    agentMarkdown: `---
display_name: ${displayName}
description: 测试成员
---

${privateBody}
`,
  };
}

async function fileFingerprint(filePath: string): Promise<{ sha256: string; byteLength: number }> {
  const content = await fs.readFile(filePath);
  return {
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    byteLength: content.byteLength,
  };
}
