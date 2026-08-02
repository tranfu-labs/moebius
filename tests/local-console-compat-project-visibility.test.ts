import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer } from "../src/local-console/start.js";
import { createSqliteLocalConsoleStore, type SqliteLocalConsoleStore } from "../src/local-console/store.js";
import { runSqliteStateCommand } from "../src/sqlite-state.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
} from "../src/local-console/types.js";

const NOW = "2026-07-25T00:00:00.000Z";

type FixtureMutation = (database: DatabaseSync, root: string) => void;

interface VisibilityCase {
  name: string;
  mutate: FixtureMutation;
}

const projectAndSessionFieldCases: VisibilityCase[] = [
  {
    name: "project source type differs from the compatibility baseline",
    mutate: (database) => database.prepare("UPDATE projects SET source_type = 'imported-folder' WHERE project_id = ?")
      .run(LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "project title was renamed",
    mutate: (database) => database.prepare("UPDATE projects SET title = '我的项目' WHERE project_id = ?")
      .run(LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "project folder differs from the SQLite-derived data root",
    mutate: (database, root) => database.prepare("UPDATE projects SET folder_path = ? WHERE project_id = ?")
      .run(path.join(root, "different-folder"), LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "project worktree mode was enabled",
    mutate: (database) => database.prepare("UPDATE projects SET worktree_mode = 1 WHERE project_id = ?")
      .run(LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "project carries an original folder marker",
    mutate: (database, root) => database.prepare("UPDATE projects SET original_folder_path = ? WHERE project_id = ?")
      .run(path.join(root, "original-folder"), LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "default session moved to another project",
    mutate: (database, root) => {
      insertProject(database, "other-project", path.join(root, "other-project"));
      database.prepare("UPDATE sessions SET project_id = 'other-project' WHERE session_id = ?")
        .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    },
  },
  {
    name: "default session source type differs from local",
    mutate: (database) => database.prepare("UPDATE sessions SET source_type = 'github' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has a source owner",
    mutate: (database) => database.prepare("UPDATE sessions SET source_owner = 'owner' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has a source repository",
    mutate: (database) => database.prepare("UPDATE sessions SET source_repo = 'repo' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has a source issue number",
    mutate: (database) => database.prepare("UPDATE sessions SET source_issue_number = 42 WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has effective team ownership",
    mutate: (database) => database.prepare("UPDATE sessions SET agent_team_ownership = 'system' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has an effective team id",
    mutate: (database) => database.prepare("UPDATE sessions SET agent_team_id = 'team-a' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has pending team ownership",
    mutate: (database) => database.prepare("UPDATE sessions SET agent_team_pending_ownership = 'user' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has a pending team id",
    mutate: (database) => database.prepare("UPDATE sessions SET agent_team_pending_id = 'team-b' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session uses worktree workspace mode",
    mutate: (database) => database.prepare("UPDATE sessions SET workspace_mode = 'worktree' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has a pending workspace mode",
    mutate: (database) => database.prepare("UPDATE sessions SET workspace_pending_mode = 'worktree' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session title was renamed",
    mutate: (database) => database.prepare("UPDATE sessions SET title = '历史对话' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session status differs from the initialized value",
    mutate: (database) => database.prepare("UPDATE sessions SET status = 'paused' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session was archived",
    mutate: (database) => database.prepare("UPDATE sessions SET archived_at = ? WHERE session_id = ?")
      .run(NOW, LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "default session has an unread result",
    mutate: (database) => database.prepare("UPDATE sessions SET unread_since = ? WHERE session_id = ?")
      .run(NOW, LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
];

const extraSessionCases: VisibilityCase[] = [
  {
    name: "an additional active session exists",
    mutate: (database) => insertSession(database, "local:active-extra", LOCAL_CONSOLE_PROJECT_ID),
  },
  {
    name: "an additional archived session exists",
    mutate: (database) => insertSession(database, "local:archived-extra", LOCAL_CONSOLE_PROJECT_ID, NOW),
  },
];

const relationshipCases: VisibilityCase[] = [
  {
    name: "sessions.parent_session_id links default as the child",
    mutate: (database) => database.prepare("UPDATE sessions SET parent_session_id = 'missing-parent' WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "sessions.parent_session_id links default as the parent",
    mutate: (database, root) => {
      insertProject(database, "child-project", path.join(root, "child-project"));
      insertSession(database, "local:column-child", "child-project", null, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    },
  },
  {
    name: "session_edges links default as the parent",
    mutate: (database) => database.prepare(
      "INSERT INTO session_edges (parent_session_id, child_session_id, relation, created_at) VALUES (?, 'missing-child', 'task', ?)",
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW),
  },
  {
    name: "session_edges links default as the child",
    mutate: (database) => database.prepare(
      "INSERT INTO session_edges (parent_session_id, child_session_id, relation, created_at) VALUES ('missing-parent', ?, 'task', ?)",
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW),
  },
];

const teamSnapshotCases: VisibilityCase[] = [
  {
    name: "an effective team snapshot exists",
    mutate: (database) => insertTeamSnapshot(database, "effective"),
  },
  {
    name: "a pending team snapshot exists",
    mutate: (database) => insertTeamSnapshot(database, "pending"),
  },
];

const cursorCases: VisibilityCase[] = [
  {
    name: "the initial cursor is missing",
    mutate: (database) => database.prepare("DELETE FROM local_message_cursors WHERE session_id = ?")
      .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "the cursor processed position advanced",
    mutate: (database) => database.prepare(
      "UPDATE local_message_cursors SET processed_through_message_id = 1 WHERE session_id = ?",
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "the cursor has an active message",
    mutate: (database) => database.prepare(
      "UPDATE local_message_cursors SET active_message_id = 99 WHERE session_id = ?",
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
  {
    name: "the cursor has an active run",
    mutate: (database) => database.prepare(
      "UPDATE local_message_cursors SET active_run_id = 'run-1' WHERE session_id = ?",
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
  },
];

const factTableCases: VisibilityCase[] = [
  {
    name: "session_messages contains history",
    mutate: (database) => database.prepare(
      `INSERT INTO session_messages
        (session_id, speaker, body, status, created_at, updated_at)
       VALUES (?, 'user', '历史消息', 'completed', ?, ?)`,
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW, NOW),
  },
  {
    name: "local_route_decisions contains history",
    mutate: (database) => database.prepare(
      `INSERT INTO local_route_decisions
        (session_id, message_id, route_key, outcome, reason, created_at)
       VALUES (?, 1, 'route-1', 'no_action', 'recorded', ?)`,
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW),
  },
  {
    name: "local_acceptance_facts contains history",
    mutate: (database) => database.prepare(
      `INSERT INTO local_acceptance_facts
        (session_id, task_id, role, verdict, evidence_json, created_at)
       VALUES (?, 'task-1', 'qa', 'passed', '{}', ?)`,
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW),
  },
  {
    name: "local_integration_events contains history",
    mutate: (database) => database.prepare(
      `INSERT INTO local_integration_events
        (session_id, event_key, status, detail_json, created_at, updated_at)
       VALUES (?, 'event-1', 'recorded', '{}', ?, ?)`,
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW, NOW),
  },
  {
    name: "local_dead_letters contains history",
    mutate: (database) => database.prepare(
      `INSERT INTO local_dead_letters
        (session_id, source_message_id, failure_count, reason, created_at)
       VALUES (?, 1, 1, 'failed', ?)`,
    ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, NOW),
  },
  {
    name: "local_workspace_diffs contains history",
    mutate: (database, root) => database.prepare(
      `INSERT INTO local_workspace_diffs
        (session_id, run_id, base_ref, branch_name, worktree_path, patch_path, status, created_at, updated_at)
       VALUES (?, 'run-1', 'base', 'main', ?, ?, 'generated', ?, ?)`,
    ).run(
      LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      path.join(root, "worktree"),
      path.join(root, "workspace.patch"),
      NOW,
      NOW,
    ),
  },
];

describe("local compatibility project visibility", { timeout: 15_000 }, () => {
  it("hides a fresh compatibility placeholder while preserving its SQLite rows and an unselected runtime state", async () => {
    const fixture = await createFixture();
    try {
      expect(await fixture.store.listProjects()).toEqual([]);
      const database = new DatabaseSync(fixture.sqlitePath, { readOnly: true });
      try {
        expect(database.prepare("SELECT project_id FROM projects WHERE project_id = ?")
          .get(LOCAL_CONSOLE_PROJECT_ID)).toEqual({ project_id: LOCAL_CONSOLE_PROJECT_ID });
        expect(database.prepare("SELECT session_id FROM sessions WHERE session_id = ?")
          .get(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toEqual({ session_id: LOCAL_CONSOLE_DEFAULT_SESSION_ID });
      } finally {
        database.close();
      }
    } finally {
      await fixture.store.close();
    }

    const started = await startLocalConsoleServer({
      projectRoot: fixture.root,
      sqlitePath: fixture.sqlitePath,
      port: 0,
      listAgentFiles: async () => [],
      runCodex: vi.fn(),
    });
    try {
      const response = await fetch(new URL("/api/local-console/state", started.url));
      expect(response.status).toBe(200);
      const state = await response.json() as {
        projects: unknown[];
        selectedProjectId: string;
        selectedSessionId: string;
        selectedSession: unknown;
      };
      expect(state).toMatchObject({
        projects: [],
        selectedProjectId: LOCAL_CONSOLE_PROJECT_ID,
        selectedSessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        selectedSession: null,
      });
    } finally {
      await started.close();
    }
  });

  it("keeps an empty upgrade placeholder hidden after restart and derives a custom data-root title without publishing it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-custom-data-root-"));
    const dataRoot = path.join(root, "custom-data");
    const sqlitePath = path.join(dataRoot, "local-console.sqlite");
    const first = await createSqliteLocalConsoleStore({ sqlitePath });
    await first.init();
    expect(await first.listProjects()).toEqual([]);
    await first.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    try {
      expect(await reopened.listProjects()).toEqual([]);
      const database = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        expect(database.prepare("SELECT title, folder_path FROM projects WHERE project_id = ?")
          .get(LOCAL_CONSOLE_PROJECT_ID)).toEqual({ title: "custom-data", folder_path: dataRoot });
      } finally {
        database.close();
      }
    } finally {
      await reopened.close();
    }
  });

  it.each([
    ...projectAndSessionFieldCases,
    ...extraSessionCases,
    ...relationshipCases,
    ...teamSnapshotCases,
    ...cursorCases,
    ...factTableCases,
  ])("keeps the compatibility project visible when $name", async ({ mutate }) => {
    const fixture = await createFixture();
    try {
      mutateDatabase(fixture.sqlitePath, (database) => mutate(database, fixture.root));
      expect((await fixture.store.listProjects()).map((project) => project.projectId))
        .toContain(LOCAL_CONSOLE_PROJECT_ID);
    } finally {
      await fixture.store.close();
    }
  });

  it("keeps the compatibility project visible when the legacy awaits-human field is populated", async () => {
    const fixture = await createFixture();
    try {
      mutateDatabase(fixture.sqlitePath, (database) => {
        database.prepare("UPDATE sessions SET awaits_human_reason = 'answer' WHERE session_id = ?")
          .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
      });
      const projects = await runSqliteStateCommand<Array<{ projectId: string }>>({
        sqlitePath: fixture.sqlitePath,
        command: { kind: "local-list-projects" },
        readOnly: true,
      });
      expect(projects.map((project) => project.projectId)).toContain(LOCAL_CONSOLE_PROJECT_ID);
    } finally {
      await fixture.store.close();
    }
  });

  it("ignores only project discovery caches, timestamps, sort order, cursor timestamp, and an unattached global draft", async () => {
    const fixture = await createFixture();
    try {
      mutateDatabase(fixture.sqlitePath, (database) => {
        database.prepare(
          `UPDATE projects
           SET workspace_cwd = ?, workspace_mode = 'worktree', worktree_path = ?,
               worktree_unavailable_reason = 'cache-only', workspace_updated_at = ?,
               sort_order = 99, created_at = ?, updated_at = ?
           WHERE project_id = ?`,
        ).run(
          path.join(fixture.root, "cached-cwd"),
          path.join(fixture.root, "cached-worktree"),
          NOW,
          "2025-01-01T00:00:00.000Z",
          NOW,
          LOCAL_CONSOLE_PROJECT_ID,
        );
        database.prepare("UPDATE sessions SET created_at = ?, updated_at = ? WHERE session_id = ?")
          .run("2025-01-01T00:00:00.000Z", NOW, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
        database.prepare("UPDATE local_message_cursors SET updated_at = ? WHERE session_id = ?")
          .run(NOW, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
        database.prepare(
          `INSERT INTO local_attachment_blobs
            (blob_id, kind, display_name, media_type, byte_size, sha256, storage_key, created_at)
           VALUES ('blob-1', 'file', 'draft.txt', 'text/plain', 1, 'hash', 'draft-key', ?)`,
        ).run(NOW);
        database.prepare(
          `INSERT INTO local_attachment_refs
            (attachment_id, blob_id, draft_key, position, created_at, updated_at)
           VALUES ('attachment-1', 'blob-1', 'new-conversation-draft', 0, ?, ?)`,
        ).run(NOW, NOW);
      });
      expect(await fixture.store.listProjects()).toEqual([]);
    } finally {
      await fixture.store.close();
    }
  });

  it("keeps the compatibility message endpoint reachable and republishes its project as soon as history exists", async () => {
    const fixture = await createFixture();
    await fixture.store.close();
    const agentPath = path.join(fixture.root, "agents", "dev-manager.md");
    await fs.mkdir(path.dirname(agentPath), { recursive: true });
    await fs.writeFile(agentPath, "# Dev Manager\n\nROLE:dev-manager\n", "utf8");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "历史已保留",
      threadId: null,
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: fixture.root,
      sqlitePath: fixture.sqlitePath,
      port: 0,
      listAgentFiles: async () => [{ name: "dev-manager", path: agentPath }],
      runCodex,
    });
    try {
      const response = await fetch(new URL("/api/local-console/messages", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "继续兼容会话" }),
      });
      expect(response.status).toBe(202);

      const stateResponse = await fetch(new URL("/api/local-console/state", started.url));
      const state = await stateResponse.json() as {
        projects: Array<{ projectId: string }>;
        selectedSession: { sessionId: string } | null;
      };
      expect(state.projects.map((project) => project.projectId)).toContain(LOCAL_CONSOLE_PROJECT_ID);
      expect(state.selectedSession).toMatchObject({ sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID });
    } finally {
      await started.close();
    }

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath: fixture.sqlitePath });
    await reopened.init();
    try {
      expect((await reopened.listProjects()).map((project) => project.projectId))
        .toContain(LOCAL_CONSOLE_PROJECT_ID);
      expect(await reopened.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID))
        .toEqual(expect.arrayContaining([expect.objectContaining({ body: "继续兼容会话" })]));
    } finally {
      await reopened.close();
    }
  });

  it("reorders only public projects and preserves their relative order across restart", async () => {
    const fixture = await createFixture();
    const folderA = path.join(fixture.root, "project-a");
    const folderB = path.join(fixture.root, "project-b");
    await Promise.all([fs.mkdir(folderA), fs.mkdir(folderB)]);
    const projectA = await fixture.store.createProject({ folderPath: folderA, worktreeMode: false, now: NOW });
    const projectB = await fixture.store.createProject({
      folderPath: folderB,
      worktreeMode: false,
      now: "2026-07-25T00:00:01.000Z",
    });
    expect((await fixture.store.listProjects()).map((project) => project.projectId))
      .toEqual([projectB.projectId, projectA.projectId]);
    await expect(fixture.store.reorderProjects([projectA.projectId, projectB.projectId]))
      .resolves.toEqual([
        expect.objectContaining({ projectId: projectA.projectId }),
        expect.objectContaining({ projectId: projectB.projectId }),
      ]);
    await fixture.store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath: fixture.sqlitePath });
    await reopened.init();
    try {
      expect((await reopened.listProjects()).map((project) => project.projectId))
        .toEqual([projectA.projectId, projectB.projectId]);
      const database = new DatabaseSync(fixture.sqlitePath, { readOnly: true });
      try {
        expect(database.prepare("SELECT project_id FROM projects WHERE project_id = ?")
          .get(LOCAL_CONSOLE_PROJECT_ID)).toEqual({ project_id: LOCAL_CONSOLE_PROJECT_ID });
      } finally {
        database.close();
      }
    } finally {
      await reopened.close();
    }
  });

  it("keeps a removed compatibility record internal instead of reclassifying it as a visible project", async () => {
    const fixture = await createFixture();
    try {
      mutateDatabase(fixture.sqlitePath, (database) => {
        database.prepare("UPDATE projects SET removed_at = ? WHERE project_id = ?")
          .run(NOW, LOCAL_CONSOLE_PROJECT_ID);
      });
      expect(await fixture.store.listProjects()).toEqual([]);
      const database = new DatabaseSync(fixture.sqlitePath, { readOnly: true });
      try {
        expect(database.prepare("SELECT removed_at FROM projects WHERE project_id = ?")
          .get(LOCAL_CONSOLE_PROJECT_ID)).toEqual({ removed_at: NOW });
      } finally {
        database.close();
      }
    } finally {
      await fixture.store.close();
    }
  });
});

async function createFixture(): Promise<{
  root: string;
  sqlitePath: string;
  store: SqliteLocalConsoleStore;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-compat-project-"));
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  return { root, sqlitePath, store };
}

function mutateDatabase(sqlitePath: string, mutate: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(sqlitePath);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function insertProject(database: DatabaseSync, projectId: string, folderPath: string): void {
  database.prepare(
    `INSERT INTO projects
      (project_id, source_type, title, folder_path, worktree_mode, sort_order, created_at, updated_at)
     VALUES (?, 'local-folder', ?, ?, 0, 0, ?, ?)`,
  ).run(projectId, path.basename(folderPath), folderPath, NOW, NOW);
}

function insertSession(
  database: DatabaseSync,
  sessionId: string,
  projectId: string,
  archivedAt: string | null = null,
  parentSessionId: string | null = null,
): void {
  database.prepare(
    `INSERT INTO sessions
      (session_id, project_id, source_type, parent_session_id, workspace_mode, title, status, archived_at, created_at, updated_at)
     VALUES (?, ?, 'local', ?, 'direct', ?, 'active', ?, ?, ?)`,
  ).run(sessionId, projectId, parentSessionId, sessionId, archivedAt, NOW, NOW);
}

function insertTeamSnapshot(database: DatabaseSync, slot: "effective" | "pending"): void {
  database.prepare(
    `INSERT INTO session_agent_team_members
      (session_id, slot, member_name, agent_markdown, sort_order)
     VALUES (?, ?, 'dev', '# Dev', 0)`,
  ).run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, slot);
}
