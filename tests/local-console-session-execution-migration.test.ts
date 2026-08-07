import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { projectPendingDispatch } from "../src/local-console/runtime-domain.js";
import { createSqliteProviderProfileStore } from "../src/provider-profile-store.js";

describe("session execution generations", () => {
  it("atomically migrates a frozen member profile and can end future continuation without deleting history", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-session-execution-"));
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    try {
      await store.init();
      const project = await store.createProject({
        folderPath: root,
        worktreeMode: false,
        now: "2026-08-04T00:00:00.000Z",
      });
      await store.createSession({
        sessionId: "session-a",
        projectId: project.projectId,
        title: "迁移测试",
        agentTeamOwnership: "user",
        agentTeamId: "team-a",
        agentTeamSnapshot: {
          members: [{
            name: "dev",
            agentMarkdown: "# Dev",
            executionProfile: {
              cli: "pi",
              providerId: "deepseek",
              providerProfileId: "profile-old",
              model: "deepseek-v4-flash",
              effort: "high",
            },
          }],
        },
        now: "2026-08-04T00:00:00.000Z",
      });

      const migrated = await store.updateSessionMemberExecution!({
        sessionId: "session-a",
        memberName: "dev",
        action: "migrate",
        executionProfile: {
          cli: "pi",
          providerId: "deepseek",
          providerProfileId: "profile-new",
          model: "deepseek-v4-pro",
          effort: "high",
        },
        now: "2026-08-04T00:01:00.000Z",
      });
      expect(migrated.members[0]).toMatchObject({
        continuationEnded: false,
        executionProfile: {
          cli: "pi",
          providerProfileId: "profile-new",
          model: "deepseek-v4-pro",
        },
      });
      const queued = await store.appendUserMessage({
        sessionId: "session-a",
        body: "@dev 继续处理",
        dispatch: { lane: "worker", role: "dev", reason: "single-valid-mention" },
        now: "2026-08-04T00:01:30.000Z",
      });
      const providerStore = createSqliteProviderProfileStore({ sqlitePath: store.sqlitePath });
      expect(await providerStore.listSessionReferences("profile-new")).toHaveLength(1);

      const ended = await store.updateSessionMemberExecution!({
        sessionId: "session-a",
        memberName: "dev",
        action: "end",
        now: "2026-08-04T00:02:00.000Z",
      });
      expect(ended.members[0]).toMatchObject({
        continuationEnded: true,
        executionProfile: { providerProfileId: "profile-new" },
      });
      const held = (await store.listMessages("session-a")).find((message) => message.id === queued.id)!;
      expect(held).toMatchObject({
        status: "pending",
        dispatchLane: "worker",
        dispatchRole: "dev",
        error: "TARGET_CONTINUATION_ENDED",
      });
      expect(projectPendingDispatch(held)).toMatchObject({
        targetRole: "dev",
        waitingForTeam: false,
        targetUnavailable: true,
      });
      expect(await providerStore.listSessionReferences("profile-new")).toEqual([]);

      const switched = await store.switchSessionTeam({
        sessionId: "session-a",
        agentTeamOwnership: "user",
        agentTeamId: "team-b",
        agentTeamSnapshot: {
          members: [{
            name: "dev",
            agentMarkdown: "# Replacement Dev",
            executionProfile: { cli: "codex", model: "gpt-5.3-codex", effort: "medium" },
          }],
        },
        now: "2026-08-04T00:02:30.000Z",
      });
      expect(switched).toMatchObject({ agentTeamId: "team-b", agentTeamPendingId: null });
      const resubmitted = await store.updatePendingUserMessage!({
        sessionId: "session-a",
        messageId: queued.id,
        body: "@dev 由新团队继续处理",
        now: "2026-08-04T00:03:00.000Z",
      });
      expect(resubmitted).toMatchObject({ status: "pending", error: null, dispatchRole: "dev" });
      const facts = await fs.readFile(store.getSessionFactLogPath("session-a"), "utf8");
      expect(facts.match(/"type":"update_session_member_execution"/gu)).toHaveLength(2);
      expect(facts).toContain('"action":"migrate"');
      expect(facts).toContain('"action":"end"');
    } finally {
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
