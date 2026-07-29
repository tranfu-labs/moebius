import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  NewConversationPage,
  type NewConversationPromptSuggestion,
} from "@/console/new-conversation-page";
import {
  OperatorConsole,
  type OperatorConsoleProps,
  type OperatorMessage,
  type OperatorProject,
  type OperatorSession,
} from "@/console/operator-console";
import {
  EMPTY_RIGHT_SIDEBAR_TABS,
  RIGHT_SIDEBAR_BUILTIN_TAB_TITLES,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import type { ComposerTextFragment } from "@/console/text-fragment-list";

type SessionAnalysisState =
  | "draft-single"
  | "draft-accumulated"
  | "created"
  | "zero-tabs"
  | "recovered"
  | "source-unavailable";

interface SessionAnalysisStoryProps {
  state: SessionAnalysisState;
}

const sourceSession: OperatorSession = {
  sessionId: "source-session",
  projectId: "moebius",
  agentTeamOwnership: "system",
  agentTeamId: "product-delivery",
  agentTeamHealth: "usable",
  workspaceMode: "worktree",
  workspacePendingMode: null,
  branchName: "feature/sidebar-chat",
  title: "复盘运行中的 Agent 会话",
  status: "idle",
  awaitsHumanReason: null,
  unreadSince: null,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:08:00.000Z",
};

const analysisSession: OperatorSession = {
  ...sourceSession,
  sessionId: "analysis-session",
  agentTeamId: "general-assistant",
  title: "分析 Agent 运行耗时",
  createdAt: "2026-07-29T08:09:00.000Z",
  updatedAt: "2026-07-29T08:12:00.000Z",
};

const project: OperatorProject = {
  projectId: "moebius",
  sourceType: "local-folder",
  title: "Moebius",
  folderPath: "/Users/example/agent-moebius",
  worktreeMode: true,
  workspaceCwd: "/Users/example/agent-moebius",
  workspaceMode: "worktree",
  worktreePath: "/Users/example/agent-moebius/.worktrees/sidebar-chat",
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: "2026-07-29T08:12:00.000Z",
  branchName: "feature/sidebar-chat",
  isGitRepository: true,
  directoryAvailable: true,
  sessions: [sourceSession, analysisSession],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const fragments: ComposerTextFragment[] = [
  {
    id: "fragment-1",
    label: "文本片段 1",
    text: "Moebius 会话记录：sessions/source-session.jsonl；外部执行：Codex 019b8ef2",
  },
  {
    id: "fragment-2",
    label: "文本片段 2",
    text: "Moebius 会话记录：sessions/source-session.jsonl；外部执行：Codex 019b8f47",
  },
];

const suggestions: NewConversationPromptSuggestion[] = [
  {
    id: "unexpected",
    label: "Agent 运行不符合预期？",
    prompt: "分析这个会话是否符合这个 Agent 团队设计的预期",
  },
  {
    id: "slow",
    label: "Agent 运行太长了？",
    prompt: "分析这个会话为什么占用的时间那么长，主要耗时在哪一块，是否符合团队设计的预期，是否有优化空间",
  },
];

const sourceMessages: OperatorMessage[] = [
  {
    id: 1,
    sessionId: sourceSession.sessionId,
    speaker: "user",
    role: null,
    body: "请复盘这次运行，并判断团队协作是否符合设计预期。",
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
  },
  {
    id: 2,
    sessionId: sourceSession.sessionId,
    speaker: "agent",
    role: "product-delivery-lead",
    body: "已完成本轮运行，产品、实现与验收成员依次完成了交棒。",
    status: "displayed",
    runId: "source-run",
    runDir: "/tmp/source-run",
    error: null,
    runTiming: {
      stepId: "step-source",
      attempt: 1,
      createdAt: "2026-07-29T08:00:10.000Z",
      startedAt: "2026-07-29T08:00:12.000Z",
      elapsedMs: 468_000,
      completedAt: "2026-07-29T08:08:00.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    createdAt: "2026-07-29T08:00:10.000Z",
    updatedAt: "2026-07-29T08:08:00.000Z",
  },
];

const analysisMessages: OperatorMessage[] = [
  {
    id: 11,
    sessionId: analysisSession.sessionId,
    speaker: "user",
    role: null,
    body: "分析这个会话为什么占用的时间那么长，主要耗时在哪一块，是否有优化空间？",
    textFragments: fragments,
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-29T08:09:00.000Z",
    updatedAt: "2026-07-29T08:09:00.000Z",
  },
  {
    id: 12,
    sessionId: analysisSession.sessionId,
    speaker: "agent",
    role: "assistant",
    body: [
      "主要耗时集中在多轮产品边界复核，而不是代码执行。",
      "",
      "建议方案：",
      "1. 把 sidebar chat 明确为普通会话容器。",
      "2. 将文本片段和候选问题保持为 composer 的通用能力。",
      "",
      "如果这版方案符合你的预期，我再修改本地文件。",
    ].join("\n"),
    status: "displayed",
    runId: "analysis-run",
    runDir: "/tmp/analysis-run",
    error: null,
    runTiming: {
      stepId: "step-analysis",
      attempt: 1,
      createdAt: "2026-07-29T08:09:05.000Z",
      startedAt: "2026-07-29T08:09:06.000Z",
      elapsedMs: 94_000,
      completedAt: "2026-07-29T08:10:40.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    createdAt: "2026-07-29T08:09:05.000Z",
    updatedAt: "2026-07-29T08:10:40.000Z",
  },
];

const conversationDraftTab: RightSidebarTabsState = {
  tabs: [{
    id: "conversation-tab",
    type: "conversation",
    title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.conversation,
    sourceKey: "story:conversation",
    closable: true,
  }],
  activeTabId: "conversation-tab",
};

const createdConversationTab: RightSidebarTabsState = {
  tabs: conversationDraftTab.tabs.map((tab) => ({
    ...tab,
    title: "分析 Agent 运行耗时",
  })),
  activeTabId: conversationDraftTab.activeTabId,
};

function SessionAnalysisStory({ state }: SessionAnalysisStoryProps): JSX.Element {
  const draftState = state === "draft-single" || state === "draft-accumulated";
  const sourceUnavailable = state === "source-unavailable";
  const hasCreatedSidebarConversation = state === "created" || state === "recovered";
  const [sidebarOpen, setSidebarOpen] = useState(state !== "zero-tabs" && !sourceUnavailable);
  const [tabs, setTabs] = useState<RightSidebarTabsState>(
    state === "zero-tabs" || sourceUnavailable
      ? EMPTY_RIGHT_SIDEBAR_TABS
      : hasCreatedSidebarConversation
        ? createdConversationTab
        : conversationDraftTab,
  );
  const [draft, setDraft] = useState("");
  const [createdFromDraft, setCreatedFromDraft] = useState(false);
  const [draftFragments, setDraftFragments] = useState(
    state === "draft-accumulated" ? fragments : fragments.slice(0, 1),
  );

  const selectedSession = sourceUnavailable ? analysisSession : sourceSession;
  const messages = sourceUnavailable ? analysisMessages : sourceMessages;

  return (
    <OperatorConsole
      {...baseConsoleProps(selectedSession, messages)}
      navigationSessionId={hasCreatedSidebarConversation || sourceUnavailable
        ? analysisSession.sessionId
        : sourceSession.sessionId}
      conversationNotice={sourceUnavailable
        ? "来源会话暂时不可用，当前 sidebar chat 已在主内容区打开；会话历史、工作空间与运行能力不受影响。"
        : undefined}
      rightSidebarOpen={sidebarOpen}
      rightSidebarWidth={520}
      rightSidebarTabs={tabs}
      onRightSidebarOpenChange={setSidebarOpen}
      onRightSidebarTabsChange={setTabs}
      rightSidebarContentSlots={{
        conversation: () => (
          <div className="flex h-full min-h-0">
            {draftState && !createdFromDraft ? (
              <NewConversationPage
                projects={[{
                  projectId: project.projectId,
                  title: project.title,
                  available: true,
                  independentWorkspaceAvailable: true,
                  branchLabel: project.branchName ?? "—",
                }]}
                teams={[{
                  teamKey: "system:general-assistant",
                  label: "通用助手 · 官方来源",
                  members: [{
                    slug: "assistant",
                    displayName: "通用助手",
                    description: "没有预设专业职责的主 Agent",
                  }],
                }]}
                selectedProjectId={project.projectId}
                selectedWorkspaceMode="worktree"
                selectedTeamKey="system:general-assistant"
                draft={draft}
                textFragments={draftFragments}
                promptSuggestions={suggestions}
                onSelectProject={() => undefined}
                onSelectWorkspace={() => undefined}
                onAddProject={() => undefined}
                onSelectTeam={() => undefined}
                onDraftChange={setDraft}
                onTextFragmentRemove={(fragmentId) => {
                  setDraftFragments((current) => current.filter((fragment) => fragment.id !== fragmentId));
                }}
                onPromptSuggestionSelect={(suggestion) => setDraft(suggestion.prompt)}
                onSubmit={() => {
                  setCreatedFromDraft(true);
                  setTabs((current) => ({
                    ...current,
                    tabs: current.tabs.map((tab) => tab.type === "conversation"
                      ? { ...tab, title: "分析 Agent 运行耗时" }
                      : tab),
                  }));
                }}
              />
            ) : (
              <OperatorConsole
                {...baseConsoleProps(
                  analysisSession,
                  createdFromDraft
                    ? [{
                        ...analysisMessages[0]!,
                        body: draft,
                        textFragments: draftFragments,
                      }, analysisMessages[1]!]
                    : analysisMessages,
                )}
                presentation="conversation"
              />
            )}
          </div>
        ),
      }}
    />
  );
}

function baseConsoleProps(
  selectedSession: OperatorSession,
  messages: OperatorMessage[],
): OperatorConsoleProps {
  return {
    project,
    projects: [project],
    selectedProjectId: project.projectId,
    selectedSessionId: selectedSession.sessionId,
    selectedSession,
    messages,
    activeRun: null,
    composerValue: "",
    workspaceDiff: { available: false, fileCount: null, reason: "not-loaded" },
    onComposerChange: () => undefined,
    onSend: () => undefined,
    onSelectSession: () => undefined,
    onInterrupt: () => undefined,
  };
}

const meta = {
  title: "Page/Console/SessionAnalysis",
  component: SessionAnalysisStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SessionAnalysisStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnalysisDraftSingleFragment: Story = {
  args: { state: "draft-single" },
};

export const AnalysisDraftAccumulatedFragments: Story = {
  args: { state: "draft-accumulated" },
};

export const TextFragmentTooltipOnKeyboardFocus: Story = {
  args: { state: "draft-single" },
  play: async ({ canvasElement }) => {
    const fragment = canvasElement.querySelector<HTMLElement>(
      '[aria-label^="文本片段 1："]',
    );
    fragment?.focus();
  },
};

export const CreatedSidebarConversation: Story = {
  args: { state: "created" },
};

export const RightSidebarZeroTabs: Story = {
  args: { state: "zero-tabs" },
};

export const RecoveredSidebarConversation: Story = {
  args: { state: "recovered" },
};

export const SourceUnavailableFallback: Story = {
  args: { state: "source-unavailable" },
};
