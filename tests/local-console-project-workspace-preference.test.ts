import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { startLocalConsoleServer } from "../src/local-console/start.js";
import type {
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
} from "../src/local-console/types.js";

const NOW = "2026-08-26T00:00:00.000Z";

async function makeFixtureRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "moebius-project-workspace-preference-"));
}

async function createProject(
  url: string,
  folderPath: string,
  worktreeMode: boolean,
): Promise<LocalConsoleProjectSummary> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { project: LocalConsoleProjectSummary }).project;
}

async function updateProjectPreference(
  url: string,
  projectId: string,
  workspaceMode: "direct" | "worktree",
): Promise<LocalConsoleProjectSummary> {
  const response = await fetch(new URL(`/api/local-console/projects/${encodeURIComponent(projectId)}`, url), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worktreeMode: workspaceMode === "worktree" }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { project: LocalConsoleProjectSummary }).project;
}

async function createSession(
  url: string,
  projectId: string,
  title: string,
): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, title }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { session: LocalConsoleSessionSummary }).session;
}

describe("local console project workspace preferences", () => {
  it("isolates project defaults, preserves existing sessions, and survives store restart", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const folderA = path.join(root, "project-a");
    const folderB = path.join(root, "project-b");
    await Promise.all([
      fs.mkdir(folderA, { recursive: true }),
      fs.mkdir(folderB, { recursive: true }),
    ]);

    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      const projectA = await store.createProject({ folderPath: folderA, worktreeMode: false, now: NOW });
      const projectB = await store.createProject({ folderPath: folderB, worktreeMode: true, now: NOW });
      const existingA = await store.createSession({
        sessionId: "local:preference-existing-a",
        projectId: projectA.projectId,
        title: "existing A",
        now: NOW,
      });
      const existingB = await store.createSession({
        sessionId: "local:preference-existing-b",
        projectId: projectB.projectId,
        title: "existing B",
        now: NOW,
      });
      expect(existingA.workspaceMode).toBe("direct");
      expect(existingB.workspaceMode).toBe("worktree");

      const updatedA = await store.updateProject({
        projectId: projectA.projectId,
        worktreeMode: true,
        now: "2026-08-26T00:00:01.000Z",
      });
      expect(updatedA.worktreeMode).toBe(true);
      expect((await store.listSessions()).find((session) => session.sessionId === existingA.sessionId)?.workspaceMode)
        .toBe("direct");

      const newA = await store.createSession({
        sessionId: "local:preference-new-a",
        projectId: projectA.projectId,
        title: "new A",
        now: "2026-08-26T00:00:02.000Z",
      });
      const newB = await store.createSession({
        sessionId: "local:preference-new-b",
        projectId: projectB.projectId,
        title: "new B",
        now: "2026-08-26T00:00:03.000Z",
      });
      expect(newA.workspaceMode).toBe("worktree");
      expect(newB.workspaceMode).toBe("worktree");
    } finally {
      await store.close();
    }

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    try {
      const projects = await reopened.listProjects();
      expect(projects).toEqual(expect.arrayContaining([
        expect.objectContaining({ folderPath: folderA, worktreeMode: true }),
        expect.objectContaining({ folderPath: folderB, worktreeMode: true }),
      ]));
      expect((await reopened.listSessions()).find((session) => session.sessionId === "local:preference-existing-a")?.workspaceMode)
        .toBe("direct");
      expect((await reopened.listSessions()).find((session) => session.sessionId === "local:preference-new-a")?.workspaceMode)
        .toBe("worktree");
    } finally {
      await reopened.close();
    }
  });

  it("persists an immediate HTTP selection and uses it for later sessions after server restart", async () => {
    const root = await makeFixtureRoot();
    const folderA = path.join(root, "project-a");
    const folderB = path.join(root, "project-b");
    await Promise.all([
      fs.mkdir(folderA, { recursive: true }),
      fs.mkdir(folderB, { recursive: true }),
    ]);

    const start = () => startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      listAgentFiles: async () => [],
      isCodexThreadAvailable: async () => true,
    });
    const first = await start();
    try {
      const projectA = await createProject(first.url, folderA, false);
      const projectB = await createProject(first.url, folderB, false);
      const existingA = await createSession(first.url, projectA.projectId, "existing A");
      expect(existingA.workspaceMode).toBe("direct");

      expect((await updateProjectPreference(first.url, projectA.projectId, "worktree")).worktreeMode).toBe(true);
      expect((await createSession(first.url, projectA.projectId, "new A")).workspaceMode).toBe("worktree");
      expect((await createSession(first.url, projectB.projectId, "new B")).workspaceMode).toBe("direct");

      const stateResponse = await fetch(
        new URL(`/api/local-console/state?sessionId=${encodeURIComponent(existingA.sessionId)}`, first.url),
      );
      expect(stateResponse.status).toBe(200);
      const state = (await stateResponse.json()) as {
        selectedSession: LocalConsoleSessionSummary | null;
      };
      expect(state.selectedSession?.workspaceMode).toBe("direct");
    } finally {
      await first.close();
    }

    const restarted = await start();
    try {
      const projectsResponse = await fetch(new URL("/api/local-console/state", restarted.url));
      expect(projectsResponse.status).toBe(200);
      const state = (await projectsResponse.json()) as {
        projects: LocalConsoleProjectSummary[];
      };
      expect(state.projects).toEqual(expect.arrayContaining([
        expect.objectContaining({ folderPath: folderA, worktreeMode: true }),
        expect.objectContaining({ folderPath: folderB, worktreeMode: false }),
      ]));
    } finally {
      await restarted.close();
    }
  });

  it("rejects an invalid preference payload without changing the project default", async () => {
    const root = await makeFixtureRoot();
    const folder = path.join(root, "project");
    await fs.mkdir(folder, { recursive: true });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      listAgentFiles: async () => [],
      isCodexThreadAvailable: async () => true,
    });
    try {
      const project = await createProject(started.url, folder, false);
      const response = await fetch(new URL(`/api/local-console/projects/${encodeURIComponent(project.projectId)}`, started.url), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worktreeMode: "worktree" }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "Expected a string title or boolean worktreeMode field",
      });
      expect((await createSession(started.url, project.projectId, "after invalid input")).workspaceMode).toBe("direct");
    } finally {
      await started.close();
    }
  });
});
