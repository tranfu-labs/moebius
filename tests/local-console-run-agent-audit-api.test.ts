import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRunExecutionContext } from "../src/local-console/execution-context.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalConsoleStore } from "../src/local-console/types.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("run-scoped Agent audit HTTP API", () => {
  it("distinguishes process-start proof from pre-start rejection and preserves the one-shot override", async () => {
    const fixture = await startFixture();
    const executed = context({
      sessionId: fixture.sessionA,
      runId: "run-executed",
      profile: { cli: "kimi", model: "override-model", effort: "xhigh" },
      markdown: "# Historical lead\n",
    });
    await fixture.store.recordRunExecutionContext!(executed);
    await fixture.store.recordProviderProcessStarted!({
      sessionId: fixture.sessionA,
      runId: executed.runId,
      role: "lead",
      engine: "kimi",
      startedAt: "2026-08-04T01:00:01.000Z",
    });
    await fixture.store.recordProviderProcessStarted!({
      sessionId: fixture.sessionA,
      runId: executed.runId,
      role: "lead",
      engine: "kimi",
      startedAt: "2026-08-04T01:00:02.000Z",
    });

    const planned = context({ sessionId: fixture.sessionA, runId: "run-planned", markdown: "# Planned\n" });
    await fixture.store.recordRunExecutionContext!(planned);
    await fixture.store.recordProviderProcessStarted!({
      sessionId: fixture.sessionA,
      runId: planned.runId,
      role: "lead",
      engine: "codex",
      startedAt: "2026-08-04T01:00:30.000Z",
    });
    await fixture.store.recordSystemMessage({
      sessionId: fixture.sessionA,
      body: "process did not start",
      runId: planned.runId,
      runDir: null,
      error: "spawn rejected",
      status: "failed",
      systemEventKind: "run-not-started",
      now: "2026-08-04T01:01:00.000Z",
    });

    await expect(getJson(fixture.server.url, fixture.sessionA, executed.runId, "agent-info"))
      .resolves.toMatchObject({
        status: 200,
        body: {
          evidence: "executed",
          profile: { cli: "kimi", model: "override-model", effort: "xhigh" },
          team: { name: "Historical Team", ownership: "system", sourceName: "Moebius" },
          agent: { slug: "lead", displayName: "Historical Lead" },
        },
      });
    await expect(getJson(fixture.server.url, fixture.sessionA, planned.runId, "agent-info"))
      .resolves.toMatchObject({ status: 200, body: { evidence: "planned-not-started" } });
    expect(fixture.liveLoader).not.toHaveBeenCalled();
  });

  it("projects legacy missing fields without borrowing current team data", async () => {
    const fixture = await startFixture();
    await fixture.store.recordRunExecutionContext!(createRunExecutionContext({
      sessionId: fixture.sessionA,
      runId: "run-legacy",
      sourceMessageId: 3,
      role: "legacy",
      profile: null,
      workspace: workspace(),
      team: [{ name: "legacy", agentMarkdown: "# Legacy\n", executionProfile: null }],
      recordedAt: "2026-08-04T01:02:00.000Z",
    }));

    await expect(getJson(fixture.server.url, fixture.sessionA, "run-legacy", "agent-info"))
      .resolves.toEqual({
        status: 200,
        body: {
          sessionId: fixture.sessionA,
          runId: "run-legacy",
          role: "legacy",
          agent: { slug: "legacy", displayName: null, description: null },
          team: { name: null, ownership: null, sourceName: null },
          profile: null,
          loadedAt: null,
          evidence: "bound-start-unknown",
        },
      });
    expect(fixture.liveLoader).not.toHaveBeenCalled();
  });

  it("fails closed across session, run, bound role and arbitrary query parameters", async () => {
    const fixture = await startFixture();
    await fixture.store.recordRunExecutionContext!(context({
      sessionId: fixture.sessionA,
      runId: "run-private",
      markdown: "PRIVATE_MARKDOWN",
    }));
    await fixture.store.recordRunExecutionContext!(createRunExecutionContext({
      sessionId: fixture.sessionA,
      runId: "run-role-mismatch",
      sourceMessageId: 4,
      role: "intruder",
      profile: null,
      workspace: workspace(),
      team: [{ name: "lead", agentMarkdown: "PRIVATE_MARKDOWN", executionProfile: null }],
      recordedAt: "2026-08-04T01:03:00.000Z",
    }));

    for (const [sessionId, runId] of [
      [fixture.sessionB, "run-private"],
      [fixture.sessionA, "missing-run"],
      [fixture.sessionA, "run-role-mismatch"],
    ] as const) {
      const response = await getJson(fixture.server.url, sessionId, runId, "agent-markdown");
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: "RUN_AGENT_AUDIT_NOT_FOUND" });
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE_MARKDOWN");
    }

    for (const query of ["role=lead", "team=system%3Ateam-a", "member=lead", "path=%2Ftmp%2Fsecret"]) {
      const response = await fetch(
        new URL(`/api/local-console/sessions/${encodeURIComponent(fixture.sessionA)}/runs/run-private/agent-info?${query}`, fixture.server.url),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "RUN_AGENT_AUDIT_INVALID_REQUEST" });
    }
  });

  it("returns the frozen Markdown as JSON data without turning markup into executable output", async () => {
    const fixture = await startFixture();
    const markdown = "# Historical\n\n</script><script>alert('x')</script>\u2028PRIVATE";
    await fixture.store.recordRunExecutionContext!(context({
      sessionId: fixture.sessionA,
      runId: "run-markdown",
      markdown,
    }));
    const response = await fetch(
      new URL(`/api/local-console/sessions/${encodeURIComponent(fixture.sessionA)}/runs/run-markdown/agent-markdown`, fixture.server.url),
    );
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({ markdown });
    expect(raw).not.toContain("<html");
  });
});

async function startFixture(): Promise<{
  root: string;
  server: StartedLocalConsoleServer;
  store: LocalConsoleStore;
  sessionA: string;
  sessionB: string;
  liveLoader: ReturnType<typeof vi.fn>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-run-agent-audit-api-"));
  roots.push(root);
  const store = await createSqliteLocalConsoleStore({
    sqlitePath: path.join(root, "state.sqlite"),
    sessionLogRoot: path.join(root, "sessions"),
  });
  const liveLoader = vi.fn(async () => { throw new Error("audit must not read the current team"); });
  const server = await startLocalConsoleServer({
    projectRoot: root,
    dataRoot: root,
    port: 0,
    store,
    loadAgentTeamSnapshot: liveLoader,
    storeTimeoutMs: 2_000,
  });
  servers.push(server);
  const sessionA = "audit-session-a";
  const sessionB = "audit-session-b";
  await store.createSession({ sessionId: sessionA, title: "A", now: "2026-08-04T01:00:00.000Z" });
  await store.createSession({ sessionId: sessionB, title: "B", now: "2026-08-04T01:00:00.000Z" });
  return { root, server, store, sessionA, sessionB, liveLoader };
}

function context(input: {
  sessionId: string;
  runId: string;
  markdown: string;
  profile?: { cli: "codex" | "claude" | "kimi"; model: string; effort: string } | null;
}) {
  return createRunExecutionContext({
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: 1,
    role: "lead",
    profile: input.profile === undefined ? { cli: "codex", model: "saved-model", effort: "high" } : input.profile,
    workspace: workspace(),
    team: [{ name: "lead", agentMarkdown: input.markdown, executionProfile: null }],
    teamSnapshot: {
      team: {
        ownership: "system",
        id: "team-a",
        name: "Historical Team",
        description: "Historical purpose",
        primaryAgentSlug: "lead",
        officialSourceName: "Moebius",
      },
      loadedAt: "2026-08-04T00:00:00.000Z",
      members: [{
        name: "lead",
        displayName: "Historical Lead",
        description: "Historical description",
        agentMarkdown: input.markdown,
        executionProfile: { cli: "claude", model: "saved-member-model", effort: "medium" },
      }],
    },
    recordedAt: "2026-08-04T01:00:00.000Z",
  });
}

function workspace() {
  return {
    cwd: "/tmp/work",
    mode: "direct" as const,
    worktreePath: null,
    worktreeUnavailableReason: null,
    branchName: null,
    baseRef: null,
    originalRepoRoot: null,
  };
}

async function getJson(
  baseUrl: string,
  sessionId: string,
  runId: string,
  action: "agent-info" | "agent-markdown",
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/${action}`, baseUrl),
  );
  return { status: response.status, body: await response.json() };
}
