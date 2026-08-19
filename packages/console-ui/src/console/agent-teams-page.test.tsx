import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { type AgentTeamDetailState } from "./agent-team-detail";
import { AgentTeamsPage, type OperatorAgentTeam, type OperatorAgentTeamsState } from "./agent-teams-page";

describe("AgentTeamsPage official team registration recovery", () => {
  it("keeps both conflict reasons visible and exposes the product recovery actions", async () => {
    const onView = vi.fn();
    const onShow = vi.fn();
    const onPreserve = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentTeamsPage
        state={{
          status: "ready",
          teams: [userTeam],
          registrationIssues: [
            { kind: "stable-identity", canPreserve: true },
            { kind: "directory", canPreserve: true },
          ],
        }}
        useStackedRows={false}
        onViewRegistrationConflictTeam={onView}
        onShowRegistrationConflictLocation={onShow}
        onPreserveRegistrationConflicts={onPreserve}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByTestId("agent-team-registration-conflict")).toHaveTextContent(
      "现有用户团队与系统的通用助手身份冲突",
    );
    expect(screen.getByTestId("agent-team-registration-conflict")).toHaveTextContent(
      "通用助手的预定位置已有其他文件",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看现有团队" }));
    fireEvent.click(screen.getByRole("button", { name: "在 Finder 中查看" }));
    fireEvent.click(screen.getByRole("button", { name: "保留现有内容并添加官方团队" }));
    await waitFor(() => expect(onPreserve).toHaveBeenCalledOnce());
    expect(onView).toHaveBeenCalledOnce();
    expect(onShow).toHaveBeenCalledOnce();
  });
});

describe("AgentTeamsPage member identity avatars", () => {
  it("shows the same portrait for one agent across the member selector and current member heading", () => {
    const { container } = render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [userTeam] }}
        detailState={detailStateFor(userTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    const row = screen.getByTestId("agent-team-row");
    const rowAvatar = row.querySelector('[data-agent-portrait="manager"]');
    expect(rowAvatar).not.toBeNull();

    fireEvent.click(row);
    const detailAvatars = container.querySelectorAll('[data-agent-portrait="manager"]');
    expect(detailAvatars).toHaveLength(2);
    // 同一角色到哪都是同一张脸——身份体系的核心不变式
    const sources = new Set([rowAvatar, ...detailAvatars]
      .map((avatar) => avatar?.querySelector("img")?.getAttribute("src")));
    expect(sources.size).toBe(1);
  });
});

describe("AgentTeamsPage upstream grouping", () => {
  it("groups by upstream presence and opens the repository without opening the team", () => {
    const onOpenTeam = vi.fn();
    const onOpenUpstreamRepository = vi.fn();
    const followingTeam: OperatorAgentTeam = {
      ...builtInTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingTeam, userTeam] }}
        useStackedRows={false}
        onOpenTeam={onOpenTeam}
        onOpenUpstreamRepository={onOpenUpstreamRepository}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: /来自 GitHub/u })).toBeVisible();
    expect(screen.getByRole("heading", { name: /本地/u })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "来源仓库 tranfu-labs/moebius-team-development" }));
    expect(onOpenUpstreamRepository).toHaveBeenCalledWith(
      followingTeam.teamKey,
      "tranfu-labs/moebius-team-development",
    );
    expect(onOpenTeam).not.toHaveBeenCalled();
  });
});

describe("AgentTeamsPage following team detail", () => {
  it("shows a following notice with a detach action inside the opened team detail", () => {
    const onDetachUpstream = vi.fn();
    const followingUserTeam: OperatorAgentTeam = {
      ...userTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingUserTeam] }}
        detailState={detailStateFor(followingUserTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onDetachUpstream={onDetachUpstream}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByText(/来自 GitHub/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "停止接收更新" }));
    expect(onDetachUpstream).toHaveBeenCalledWith(followingUserTeam.teamKey);
  });

  it("shows the retry check outcome after clicking recheck", async () => {
    const onRetryUpstream = vi.fn().mockResolvedValue({
      status: "update-available",
      recentSync: null,
      pendingMergeMemberCount: 0,
    });
    const followingUserTeam: OperatorAgentTeam = {
      ...userTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingUserTeam] }}
        detailState={detailStateFor(followingUserTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRetryUpstream={onRetryUpstream}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onRetryUpstream).toHaveBeenCalledWith(followingUserTeam.teamKey);
    expect(await screen.findByText("发现新的作者更新。")).toBeVisible();
  });

  it("syncs an available upstream update and shows the outcome", async () => {
    const onRetryUpstream = vi.fn().mockResolvedValue({
      status: "update-available",
      recentSync: null,
      pendingMergeMemberCount: 0,
    });
    const onSyncUpstream = vi.fn().mockResolvedValue({ status: "applied", message: null });
    const followingUserTeam: OperatorAgentTeam = {
      ...userTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingUserTeam] }}
        detailState={detailStateFor(followingUserTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRetryUpstream={onRetryUpstream}
        onSyncUpstream={onSyncUpstream}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    fireEvent.click(await screen.findByRole("button", { name: "同步更新" }));

    expect(onSyncUpstream).toHaveBeenCalledWith(followingUserTeam.teamKey);
    expect(await screen.findByText("已同步上游更新。")).toBeVisible();
  });

  it("reverts a recent sync and keeps the revert entry visible until the batch is gone", async () => {
    const onRetryUpstream = vi.fn().mockResolvedValue({
      status: "up-to-date",
      recentSync: { officialVersion: "2026.08.18", occurredAt: new Date().toISOString() },
      pendingMergeMemberCount: 0,
    });
    const onRevertUpstream = vi.fn().mockResolvedValue("reverted");
    const followingUserTeam: OperatorAgentTeam = {
      ...userTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingUserTeam] }}
        detailState={detailStateFor(followingUserTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRetryUpstream={onRetryUpstream}
        onRevertUpstream={onRevertUpstream}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(await screen.findByRole("button", { name: "撤销这次同步" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "撤销这次同步" }));
    expect(onRevertUpstream).toHaveBeenCalledWith(followingUserTeam.teamKey);
  });

  it("offers a sync for pending merges and shows the pending-merge note", async () => {
    const onRetryUpstream = vi.fn().mockResolvedValue({
      status: "up-to-date",
      recentSync: null,
      pendingMergeMemberCount: 1,
    });
    const onSyncUpstream = vi.fn().mockResolvedValue({ status: "up-to-date", message: null });
    const followingUserTeam: OperatorAgentTeam = {
      ...userTeam,
      upstreamRepository: "tranfu-labs/moebius-team-development",
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [followingUserTeam] }}
        detailState={detailStateFor(followingUserTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRetryUpstream={onRetryUpstream}
        onSyncUpstream={onSyncUpstream}
        onSelectMember={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(await screen.findByText(/尚未合入/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "同步更新" }));
    expect(onSyncUpstream).toHaveBeenCalledWith(followingUserTeam.teamKey);
  });
});

describe("AgentTeamsPage built-in duplication", () => {
  it("opens the copied user team detail after the whole-team operation succeeds", async () => {
    const onDuplicate = vi.fn();
    render(<DuplicateTeamHarness onDuplicate={onDuplicate} />);

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByTestId("agent-team-detail-view")).toHaveAttribute("data-team-key", builtInTeam.teamKey);
    expect(screen.getByText("官方来源")).toBeVisible();
    expect(screen.queryByText("只读")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制团队" }));

    await waitFor(() => expect(screen.getByTestId("agent-team-detail-view"))
      .toHaveAttribute("data-team-key", copiedTeam.teamKey));
    expect(onDuplicate).toHaveBeenCalledWith(builtInTeam.teamKey);
    expect(screen.getByText("用户团队")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" })).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "复制团队" })).not.toBeInTheDocument();
  });

  it("never shows team deletion or member mutation controls for a built-in team", async () => {
    render(<DuplicateTeamHarness onDuplicate={() => undefined} />);
    fireEvent.click(screen.getByTestId("agent-team-row"));

    expect(screen.queryByRole("button", { name: "团队 的操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开发经理 的操作" })).not.toBeInTheDocument();
    expect(screen.queryByText("删除 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText(/废纸篓|回收站/u)).not.toBeInTheDocument();
  });
});

describe("AgentTeamsPage official sync revert confirmation", () => {
  it("asks for confirmation with the reverted version and member count before reverting from the recent-sync panel", async () => {
    const onRevertSync = vi.fn();
    const syncedTeam: OperatorAgentTeam = {
      ...builtInTeam,
      recentOfficialSync: {
        officialVersion: "2",
        affectedMemberCount: 1,
        memberChanges: {
          added: ["dev"],
          removed: [],
          renamed: [],
          adopted: [],
          recommendationChanged: [],
          keptOverridden: [],
          collidedMembers: [],
          mergedMembers: [],
          pendingMergeMembers: [],
        },
        occurredAt: "2026-08-11T00:00:00.000Z",
      },
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [syncedTeam] }}
        detailState={detailStateFor(syncedTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onCloseTeam={() => undefined}
        onSelectMember={() => undefined}
        onChangePrimaryAgent={() => undefined}
        onChangeMember={() => undefined}
        onSaveMember={() => undefined}
        onRetryMember={() => undefined}
        onDiscardMember={() => undefined}
        onDiscardAll={() => undefined}
        onSaveAll={async () => ({ failures: [] })}
        onRevertSync={onRevertSync}
        onBack={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.keyDown(screen.getByRole("button", { name: "开发团队 的操作" }), { key: "ArrowDown" });
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "最近的官方同步" }));

    const panel = screen.getByTestId("recent-official-sync-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "撤销这次同步" }));
    const dialog = screen.getByRole("dialog", { name: "撤销这次同步" });
    expect(dialog.textContent).toContain("官方 2");
    expect(dialog.textContent).toContain("1 名成员");
    expect(onRevertSync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "撤销同步" }));
    expect(onRevertSync).toHaveBeenCalledWith(syncedTeam.teamKey);
  });
});

describe("AgentTeamsPage creation entry", () => {
  it("keeps finding an existing team visible beside the new-team menu", async () => {
    const onDiscoverTeams = vi.fn();
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [builtInTeam] }}
        useStackedRows={false}
        onDiscoverTeams={onDiscoverTeams}
        onCreateTeam={vi.fn()}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "找现成团队" }));
    expect(onDiscoverTeams).toHaveBeenCalledOnce();

    await openMenu("新建团队");
    expect(screen.getByRole("menuitem", { name: "从空白开始" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "找现成团队" })).not.toBeInTheDocument();
  });

  it("opens a two-path menu, uses the page body for AI building, and keeps blank creation in the dialog", async () => {
    const onStart = vi.fn(async () => null);
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [builtInTeam] }}
        detailState={detailStateFor(builtInTeam.teamKey)}
        useStackedRows={false}
        aiTeamBuilder={{
          state: {
            phase: "idle",
            messages: [{
              role: "assistant",
              text: "你希望这支团队长期替你完成什么工作？",
            }],
            proposal: null,
            proposalRevision: null,
            error: null,
          },
          onStart,
          onSubmit: vi.fn(),
          onAdjust: vi.fn(),
          onRetry: vi.fn(async () => null),
          onCommit: vi.fn(async () => null),
        }}
        onCreateTeam={vi.fn()}
        onBack={() => undefined}
      />,
    );

    await openMenu("新建团队");
    expect(screen.getByRole("menuitem", { name: "跟 AI 聊出一支新团队" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "从空白开始" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "复制并编辑" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "跟 AI 聊出一支新团队" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("agent-team-ai-builder-view")).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI 团队设计器" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "新建团队" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回 Agent 团队" }));
    expect(screen.getByRole("heading", { name: "Agent 团队" })).toBeVisible();

    await openMenu("新建团队");
    fireEvent.click(screen.getByRole("menuitem", { name: "从空白开始" }));
    expect(screen.getByRole("dialog", { name: "新建团队" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "团队名称" })).toBeVisible();
  });
});

describe("AgentTeamsPage user-team file operations", () => {
  it("blocks Agent duplication on unsaved drafts until the user discards them", async () => {
    const onDiscardAll = vi.fn();
    const onDuplicateMember = vi.fn().mockResolvedValue(undefined);
    renderUserTeam({
      detailState: detailStateFor(userTeam.teamKey, { dirty: true }),
      onDiscardAll,
      onDuplicateMember,
    });

    await openMenu("开发经理 的操作");
    fireEvent.click(screen.getByRole("menuitem", { name: "复制 Agent" }));

    const dialog = screen.getByRole("dialog", { name: "还有未保存的修改" });
    expect(dialog).toHaveTextContent("只使用已经完整保存到磁盘的文件");
    expect(onDuplicateMember).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃全部并继续" }));

    await waitFor(() => expect(onDiscardAll).toHaveBeenCalledWith(userTeam.teamKey));
    await waitFor(() => expect(onDuplicateMember).toHaveBeenCalledWith(userTeam.teamKey, "manager"));
    expect(screen.getByRole("status")).toHaveTextContent("已保存 1 项，无需重启");
  });

  it("requires another primary Agent before deleting the current primary", async () => {
    const onTrashMember = vi.fn();
    renderUserTeam({ onTrashMember });

    await openMenu("开发经理 的操作");
    const item = screen.getByRole("menuitem", { name: "删除 Agent（请先更换主 Agent）" });
    expect(item).toHaveAttribute("data-disabled");
    fireEvent.click(item);
    expect(onTrashMember).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /删除/u })).not.toBeInTheDocument();
  });

  it("warns about unchanged handoff references before deleting a non-primary Agent", async () => {
    const onTrashMember = vi.fn().mockResolvedValue(undefined);
    renderUserTeam({
      detailState: detailStateFor(userTeam.teamKey, { selectedMemberSlug: "dev" }),
      onTrashMember,
    });

    await openMenu("开发 的操作");
    fireEvent.click(screen.getByRole("menuitem", { name: "删除 Agent" }));

    const dialog = screen.getByRole("dialog", { name: "删除“开发”？" });
    expect(dialog).toHaveTextContent("其他成员的交棒规则可能仍引用 @dev");
    expect(dialog).toHaveTextContent("不会自动理解、清理或改写这些规则");
    expect(dialog).toHaveTextContent("整个目录、AGENT.md 和相关文件");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 Agent" }));
    await waitFor(() => expect(onTrashMember).toHaveBeenCalledWith(userTeam.teamKey, "dev"));
    expect(screen.getByRole("status")).toHaveTextContent("已保存 1 项，无需重启");
  });

  it("saves outstanding drafts before team deletion, then explains every affected file and preserved sessions", async () => {
    const onSaveAll = vi.fn().mockResolvedValue({ failures: [] });
    const onTrashUserTeam = vi.fn().mockResolvedValue(undefined);
    renderUserTeam({
      detailState: detailStateFor(userTeam.teamKey, { dirty: true }),
      onSaveAll,
      onTrashUserTeam,
    });

    await openMenu("我的开发团队 的操作");
    fireEvent.click(screen.getByRole("menuitem", { name: "移到废纸篓 / 回收站" }));
    const draftDialog = screen.getByRole("dialog", { name: "还有未保存的修改" });
    expect(onTrashUserTeam).not.toHaveBeenCalled();
    fireEvent.click(within(draftDialog).getByRole("button", { name: "保存全部并继续" }));

    await waitFor(() => expect(onSaveAll).toHaveBeenCalledWith(userTeam.teamKey));
    const confirm = await screen.findByRole("dialog", { name: "把“我的开发团队”移到系统废纸篓或回收站？" });
    expect(confirm).toHaveTextContent("2 个 Agent：开发经理、开发");
    expect(confirm).toHaveTextContent("AGENT.md 和目录中的相关文件");
    expect(confirm).toHaveTextContent("已有会话及其创建时载入的团队版本会保留");
    expect(confirm).toHaveTextContent("不提供永久删除或独立的已删除团队页面");
    fireEvent.click(within(confirm).getByRole("button", { name: "移到废纸篓 / 回收站" }));

    await waitFor(() => expect(onTrashUserTeam).toHaveBeenCalledWith(userTeam.teamKey));
    await waitFor(() => expect(screen.queryByTestId("agent-team-detail-view")).not.toBeInTheDocument());
  });

  it("duplicates a user team from the detail More menu", async () => {
    const onDuplicateUserTeam = vi.fn().mockResolvedValue(userTeam.teamKey);
    renderUserTeam({ onDuplicateUserTeam });

    await openMenu("我的开发团队 的操作");
    fireEvent.click(screen.getByRole("menuitem", { name: "复制团队" }));
    await waitFor(() => expect(onDuplicateUserTeam).toHaveBeenCalledWith(userTeam.teamKey));
  });
});

describe("AgentTeamsPage file manager actions", () => {
  it("keeps team and member actions inside their More menus and opens the matching locations", async () => {
    const onOpenLocation = vi.fn().mockResolvedValue(undefined);
    render(<LocationHarness team={copiedTeam} onOpenLocation={onOpenLocation} fileManagerActionLabel="在 Finder 中打开" />);

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.queryByRole("menuitem", { name: "在 Finder 中打开" })).not.toBeInTheDocument();

    await openMenu("开发团队 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在 Finder 中打开" }));
    await waitFor(() => expect(onOpenLocation).toHaveBeenCalledWith("user:development-copy", undefined));

    await openMenu("开发经理 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在 Finder 中打开" }));
    await waitFor(() => expect(onOpenLocation).toHaveBeenCalledWith("user:development-copy", "manager"));
  });

  it("uses the Windows label supplied by the desktop and keeps official content editable", async () => {
    const onOpenLocation = vi.fn().mockResolvedValue(undefined);
    render(<LocationHarness
      team={builtInTeam}
      onOpenLocation={onOpenLocation}
      fileManagerActionLabel="在文件资源管理器中显示"
    />);

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByText("官方来源")).toBeVisible();
    expect(screen.queryByText("只读")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeVisible();

    await openMenu("开发团队 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在文件资源管理器中显示" }));
    await waitFor(() => expect(onOpenLocation).toHaveBeenCalledWith("system:development", undefined));

    await openMenu("开发经理 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在文件资源管理器中显示" }));
    await waitFor(() => expect(onOpenLocation).toHaveBeenCalledWith("system:development", "manager"));
  });

  it("shows a plain-language error without exposing the underlying system error", async () => {
    const onOpenLocation = vi.fn().mockRejectedValue(new Error("EACCES /private/internal/path"));
    render(<LocationHarness team={copiedTeam} onOpenLocation={onOpenLocation} fileManagerActionLabel="在文件管理器中打开" />);

    fireEvent.click(screen.getByTestId("agent-team-row"));
    await openMenu("开发经理 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在文件管理器中打开" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("暂时无法打开这个位置");
    expect(alert).toHaveTextContent("检查访问权限后重试");
    expect(alert).not.toHaveTextContent(/EACCES|private|internal/u);
  });

  it("opens an unfinished empty team's directory without exposing a member action", async () => {
    const onOpenLocation = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [emptyDraftTeam] }}
        detailState={emptyDraftDetailState}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onAddMember={() => undefined}
        fileManagerActionLabel="在 Finder 中打开"
        onOpenLocation={onOpenLocation}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByRole("button", { name: "添加第一个 Agent" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: / 的操作/u })).toHaveLength(1);

    await openMenu("草稿团队 的操作");
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "在 Finder 中打开" }));

    await waitFor(() => expect(onOpenLocation).toHaveBeenCalledWith("user:draft", undefined));
  });
});

describe("AgentTeamsPage repair actions", () => {
  it("marks a broken row as unavailable for new conversations and exposes location repair callbacks", async () => {
    const onRecheckTeam = vi.fn();
    const onRelocateTeam = vi.fn().mockResolvedValue(undefined);
    const onRemoveTeamRecord = vi.fn().mockResolvedValue(undefined);
    const repairTeam: OperatorAgentTeam = {
      ...copiedTeam,
      status: "needs-repair",
      canCreateConversation: false,
      issues: [{ code: "team-directory-missing" }],
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [repairTeam] }}
        detailState={detailStateFor(repairTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRecheckTeam={onRecheckTeam}
        onRelocateTeam={onRelocateTeam}
        onRemoveTeamRecord={onRemoveTeamRecord}
        onBack={() => undefined}
      />,
    );

    const row = screen.getByTestId("agent-team-row");
    expect(row).toHaveAttribute("data-can-create-conversation", "false");
    expect(row).toHaveTextContent("暂时无法用于新对话");
    expect(within(row).getByTestId("agent-team-members")).toHaveTextContent("成员信息暂时无法读取");
    for (const member of repairTeam.members) {
      expect(within(row).queryByText(member.displayName)).not.toBeInTheDocument();
    }
    fireEvent.click(row);

    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(onRecheckTeam).toHaveBeenCalledWith(repairTeam.teamKey));
    fireEvent.click(screen.getByRole("button", { name: "重新定位团队" }));
    await waitFor(() => expect(onRelocateTeam).toHaveBeenCalledWith(repairTeam.teamKey));
    fireEvent.click(screen.getByRole("button", { name: "移除记录" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "移除失效团队记录" }))
      .getByRole("button", { name: "只移除记录" }));
    await waitFor(() => expect(onRemoveTeamRecord).toHaveBeenCalledWith(repairTeam.teamKey));
  });

  it("keeps relocation and record removal specific to unavailable team folders", () => {
    const onCheckMemberExternalChange = vi.fn();
    const memberRepairTeam: OperatorAgentTeam = {
      ...copiedTeam,
      status: "needs-repair",
      canCreateConversation: false,
      issues: [{ code: "member-agent-missing", slug: "manager" }],
    };
    render(
      <AgentTeamsPage
        state={{ status: "ready", teams: [memberRepairTeam] }}
        detailState={detailStateFor(memberRepairTeam.teamKey)}
        useStackedRows={false}
        onOpenTeam={() => undefined}
        onRecheckTeam={() => undefined}
        onRelocateTeam={() => undefined}
        onRemoveTeamRecord={() => undefined}
        onCheckMemberExternalChange={onCheckMemberExternalChange}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByRole("button", { name: "重新检查" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新定位团队" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除记录" })).not.toBeInTheDocument();
    expect(onCheckMemberExternalChange).not.toHaveBeenCalled();
  });
});

function LocationHarness({
  team,
  fileManagerActionLabel,
  onOpenLocation,
}: {
  team: OperatorAgentTeam;
  fileManagerActionLabel: string;
  onOpenLocation(teamKey: string, memberSlug?: string): Promise<void>;
}): JSX.Element {
  return (
    <AgentTeamsPage
      state={{ status: "ready", teams: [team] }}
      detailState={detailStateFor(team.teamKey)}
      useStackedRows={false}
      onOpenTeam={() => undefined}
      onSelectMember={() => undefined}
      onChangeMember={() => undefined}
      onSaveMember={() => undefined}
      onRetryMember={() => undefined}
      onDiscardMember={() => undefined}
      onDiscardAll={() => undefined}
      onSaveAll={async () => ({ failures: [] })}
      onDuplicateBuiltInTeam={async () => copiedTeam.teamKey}
      fileManagerActionLabel={fileManagerActionLabel}
      onOpenLocation={onOpenLocation}
      onBack={() => undefined}
    />
  );
}

async function openMenu(triggerName: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: triggerName }), { key: "ArrowDown" });
  await screen.findByRole("menu");
}

function DuplicateTeamHarness({ onDuplicate }: { onDuplicate(teamKey: string): void }): JSX.Element {
  const [teamsState, setTeamsState] = useState<OperatorAgentTeamsState>({ status: "ready", teams: [builtInTeam] });
  const [detailTeamKey, setDetailTeamKey] = useState(builtInTeam.teamKey);

  return (
    <AgentTeamsPage
      state={teamsState}
      detailState={detailStateFor(detailTeamKey)}
      useStackedRows={false}
      onOpenTeam={setDetailTeamKey}
      onSelectMember={() => undefined}
      onChangeMember={() => undefined}
      onSaveMember={() => undefined}
      onRetryMember={() => undefined}
      onDiscardMember={() => undefined}
      onDiscardAll={() => undefined}
      onSaveAll={async () => ({ failures: [] })}
      onDuplicateBuiltInTeam={async (teamKey) => {
        onDuplicate(teamKey);
        setTeamsState({ status: "ready", teams: [builtInTeam, copiedTeam] });
        setDetailTeamKey(copiedTeam.teamKey);
        return copiedTeam.teamKey;
      }}
      onBack={() => undefined}
    />
  );
}

const builtInTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "负责软件方案、实现和验收",
  primaryAgentSlug: "manager",
  memberOrder: ["manager"],
  members: [{
    slug: "manager",
    displayName: "开发经理",
    description: "默认接单",
    executionProfile: staticProfile(),
  }],
  status: "usable",
  canCreateConversation: true,
};

const copiedTeam: OperatorAgentTeam = {
  ...builtInTeam,
  teamKey: "user:development-copy",
  id: "development-copy",
  ownership: "user",
};

const emptyDraftTeam: OperatorAgentTeam = {
  teamKey: "user:draft",
  id: "draft",
  ownership: "user",
  name: "草稿团队",
  description: "等待添加第一名 Agent",
  primaryAgentSlug: null,
  memberOrder: [],
  members: [],
  status: "unfinished-draft",
  canCreateConversation: false,
};

const emptyDraftDetailState: AgentTeamDetailState = {
  teamKey: emptyDraftTeam.teamKey,
  selectedMemberSlug: null,
  memberEditors: {},
  saveAllFailures: [],
};

const userTeam: OperatorAgentTeam = {
  teamKey: "user:my-development",
  id: "my-development",
  ownership: "user",
  name: "我的开发团队",
  description: "负责软件方案、实现和验收",
  primaryAgentSlug: "manager",
  memberOrder: ["manager", "dev"],
  members: [
    {
      slug: "manager",
      displayName: "开发经理",
      description: "默认接单",
      executionProfile: staticProfile(),
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "负责实现",
      executionProfile: staticProfile(),
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

function staticProfile() {
  const profile = { cli: "codex" as const, model: "gpt-5.6-sol", effort: "high" };
  return {
    binding: { source: "explicit" as const, profile },
    recommendation: null,
    effectiveProfile: profile,
  };
}

function detailStateFor(
  teamKey: string,
  options: { dirty?: boolean; selectedMemberSlug?: string } = {},
): AgentTeamDetailState {
  return {
    teamKey,
    selectedMemberSlug: options.selectedMemberSlug ?? "manager",
    memberEditors: {
      manager: {
        memberSlug: "manager",
        loadStatus: "ready",
        loadError: null,
        draftMarkdown: "# 开发经理\n\n默认接单\n",
        isDirty: options.dirty ?? false,
        saveStatus: "idle",
        saveError: null,
        externalChangeStatus: "none",
        displayName: "开发经理",
        description: "默认接单",
      },
      dev: {
        memberSlug: "dev",
        loadStatus: "ready",
        loadError: null,
        draftMarkdown: "# 开发\n\n负责实现\n",
        isDirty: false,
        saveStatus: "idle",
        saveError: null,
        externalChangeStatus: "none",
        displayName: "开发",
        description: "负责实现",
      },
    },
    saveAllFailures: [],
  };
}

function renderUserTeam(overrides: {
  detailState?: AgentTeamDetailState;
  onDiscardAll?: (teamKey: string) => void;
  onSaveAll?: (teamKey: string) => Promise<{ failures: [] }>;
  onDuplicateUserTeam?: (teamKey: string) => Promise<string>;
  onDuplicateMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashUserTeam?: (teamKey: string) => void | Promise<void>;
} = {}): void {
  render(
    <AgentTeamsPage
      state={{ status: "ready", teams: [userTeam] }}
      detailState={overrides.detailState ?? detailStateFor(userTeam.teamKey)}
      useStackedRows={false}
      onOpenTeam={() => undefined}
      onCloseTeam={() => undefined}
      onSelectMember={() => undefined}
      onChangePrimaryAgent={() => undefined}
      onChangeMember={() => undefined}
      onSaveMember={() => undefined}
      onRetryMember={() => undefined}
      onDiscardMember={() => undefined}
      onDiscardAll={overrides.onDiscardAll ?? (() => undefined)}
      onSaveAll={overrides.onSaveAll ?? (async () => ({ failures: [] }))}
      onDuplicateUserTeam={overrides.onDuplicateUserTeam}
      onDuplicateMember={overrides.onDuplicateMember}
      onTrashMember={overrides.onTrashMember}
      onTrashUserTeam={overrides.onTrashUserTeam}
      onBack={() => undefined}
    />,
  );
  fireEvent.click(screen.getByTestId("agent-team-row"));
}
