import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OperatorAgentTeam } from "./agent-teams-page";
import { ComposerContext } from "./composer-context";
import type { OperatorProject, OperatorSession } from "./operator-console";

describe("ComposerContext", () => {
  it("renders project, workspace, real branch, and team in fixed order", () => {
    const { container } = renderContext();
    const text = container.textContent ?? "";
    expect(text.indexOf("moebius")).toBeLessThan(text.indexOf("独立工作空间"));
    expect(text.indexOf("独立工作空间")).toBeLessThan(text.indexOf("feat/context"));
    expect(text.indexOf("feat/context")).toBeLessThan(text.indexOf("开发团队"));
    expect(screen.getByLabelText("分支：feat/context")).toBeVisible();
    expect(screen.queryByText("当前分支")).not.toBeInTheDocument();
    expect(screen.queryByText("会话分支")).not.toBeInTheDocument();
    expect(screen.getByLabelText("工作空间：独立工作空间，已锁定")).toBeVisible();
    expect(screen.queryByRole("button", { name: /工作空间/u })).not.toBeInTheDocument();
  });

  it("explains a disabled independent workspace inside the menu", () => {
    renderContext({
      session: { ...session, workspaceMode: "direct", workspaceUnavailableReason: "not-git-repository" },
      onChangeSessionWorkspace: vi.fn(),
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "工作空间：默认工作空间，点击切换" }), {
      key: "ArrowDown",
    });
    const item = screen.getByText("独立工作空间").closest('[role="menuitemcheckbox"]');
    expect(item).toHaveAttribute("data-disabled");
    expect(screen.getByText("这个项目文件夹不是 git 仓库，无法隔离改动")).toBeVisible();
  });

  it("makes the team selectable and discloses the creation-time snapshot", () => {
    const onChangeSessionTeam = vi.fn();
    renderContext({ onChangeSessionTeam });
    const trigger = screen.getByRole("button", { name: "Agent 团队：开发团队，点击切换" });
    expect(trigger).not.toHaveAttribute("title");
    fireEvent.keyDown(trigger, {
      key: "ArrowDown",
    });
    expect(screen.getByRole("menu")).toHaveClass("overflow-hidden");
    expect(screen.getByRole("menu")).toHaveStyle({
      maxHeight: "min(430px, var(--radix-dropdown-menu-content-available-height), calc(100dvh - 24px))",
    });
    expect(screen.getByTestId("agent-team-catalog")).toHaveClass("min-h-0", "overflow-y-auto", "overscroll-contain");
    expect(screen.getByText(/开始时载入的那份团队内容/u)).toBeVisible();
    expect(screen.getByText(/之后在 Agent 团队页的修改不影响它/u)).toBeVisible();
    fireEvent.click(screen.getByText("营销团队"));
    expect(onChangeSessionTeam).toHaveBeenCalledWith("session-a", marketingTeam);
  });

  it("shows only the pending team target until the current step finishes", () => {
    renderContext({
      session: {
        ...session,
        workspaceMode: "direct",
        workspacePendingMode: "worktree",
        agentTeamPendingOwnership: "user",
        agentTeamPendingId: "marketing",
      },
      pendingAgentTeam: marketingTeam,
    });
    expect(screen.getByLabelText("工作空间：默认工作空间，已锁定")).toBeVisible();
    expect(screen.getByRole("button", { name: "Agent 团队：营销团队，点击切换" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("当前这一步跑完后换成营销团队");
    expect(screen.getByRole("status")).not.toHaveTextContent("工作空间");
  });

  it("keeps the team entry while less essential context collapses on narrow windows", () => {
    const { container } = renderContext();
    const visibleEntries = () => Array.from(container.querySelectorAll("[data-context-entry]"))
      .map((entry) => entry.getAttribute("data-context-entry"));
    expect(visibleEntries()).toEqual(["project", "workspace", "branch", "team"]);

    resizeWindow(900);
    expect(visibleEntries()).toEqual(["project", "workspace", "team"]);
    resizeWindow(700);
    expect(visibleEntries()).toEqual(["project", "team"]);
    resizeWindow(500);
    expect(visibleEntries()).toEqual(["project", "team"]);
    resizeWindow(350);
    expect(visibleEntries()).toEqual(["team"]);
    expect(screen.getByRole("button", { name: "Agent 团队：开发团队，点击切换" })).toBeVisible();
  });
});

function resizeWindow(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  fireEvent(window, new Event("resize"));
}

function renderContext(input: {
  session?: OperatorSession;
  pendingAgentTeam?: OperatorAgentTeam;
  onChangeSessionWorkspace?: (sessionId: string, mode: "direct" | "worktree") => void;
  onChangeSessionTeam?: (sessionId: string, team: OperatorAgentTeam) => void;
} = {}) {
  return render(
    <ComposerContext
      project={project}
      projects={[project]}
      selectedSession={input.session ?? session}
      agentTeam={developmentTeam}
      pendingAgentTeam={input.pendingAgentTeam}
      teams={[developmentTeam, marketingTeam]}
      canChangeProject={false}
      disabled={false}
      onChangeSessionWorkspace={input.onChangeSessionWorkspace}
      onChangeSessionTeam={input.onChangeSessionTeam ?? vi.fn()}
    />,
  );
}

const session: OperatorSession = {
  sessionId: "session-a",
  projectId: "project-a",
  agentTeamOwnership: "system",
  agentTeamId: "development",
  workspaceMode: "worktree",
  workspacePendingMode: null,
  workspaceUnavailableReason: null,
  branchName: "feat/context",
  title: "context",
  status: "idle",
  awaitsHumanReason: null,
  unreadSince: null,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

const project: OperatorProject = {
  projectId: "project-a",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "/workspace/moebius",
  worktreeMode: false,
  workspaceCwd: null,
  workspaceMode: null,
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  branchName: "main",
  isGitRepository: true,
  sessions: [session],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const developmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: null,
  primaryAgentSlug: "dev-manager",
  memberOrder: [],
  members: [],
  status: "usable",
  canCreateConversation: true,
};

const marketingTeam: OperatorAgentTeam = {
  ...developmentTeam,
  teamKey: "user:marketing",
  id: "marketing",
  ownership: "user",
  name: "营销团队",
};
