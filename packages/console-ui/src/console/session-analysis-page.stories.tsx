import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type {
  AnalysisPanelEntry,
  AnalysisPanelState,
} from "@/console/analysis-panel";
import {
  NewConversationPage,
  type NewConversationPromptSuggestion,
} from "@/console/new-conversation-page";
import {
  OperatorConsole,
  type OperatorAnalysisPanelController,
  type OperatorConsoleProps,
  type OperatorMessage,
  type OperatorProject,
  type OperatorSession,
} from "@/console/operator-console";
import {
  EMPTY_RIGHT_SIDEBAR_TABS,
  openRightSidebarSourceTab,
  type RightSidebarTab,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import type { ComposerTextFragment } from "@/console/text-fragment-list";

type SessionAnalysisState =
  | "draft-single"
  | "draft-accumulated"
  | "message-menu"
  | "conversation-menu"
  | "conversation-disabled"
  | "project-unavailable"
  | "panel-closed"
  | "panel-empty"
  | "panel-loading"
  | "panel-failed"
  | "panel-multiple"
  | "nested-panel"
  | "sibling-navigation";

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
  branchName: "feature/analysis-panel",
  title: "复盘运行中的 Agent 会话",
  status: "idle",
  awaitsHumanReason: null,
  unreadSince: null,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  createdAt: "2026-07-30T06:00:00.000Z",
  updatedAt: "2026-07-30T06:08:00.000Z",
};

const alternateSourceSession: OperatorSession = {
  ...sourceSession,
  sessionId: "alternate-source-session",
  title: "官网落地页验收",
  createdAt: "2026-07-30T06:12:00.000Z",
  updatedAt: "2026-07-30T06:18:00.000Z",
};

const analysisSession: OperatorSession = {
  ...sourceSession,
  sessionId: "analysis-runtime",
  agentTeamId: "general-assistant",
  parentSessionId: sourceSession.sessionId,
  title: "分析 Agent 运行耗时",
  createdAt: "2026-07-30T06:09:00.000Z",
  updatedAt: "2026-07-30T06:12:00.000Z",
};

const roleAnalysisSession: OperatorSession = {
  ...analysisSession,
  sessionId: "analysis-role-design",
  title: "检查角色设计",
  createdAt: "2026-07-30T06:13:00.000Z",
  updatedAt: "2026-07-30T06:15:00.000Z",
};

const nestedAnalysisSession: OperatorSession = {
  ...analysisSession,
  sessionId: "analysis-reference-escaping",
  parentSessionId: analysisSession.sessionId,
  title: "检查消息引用转义",
  createdAt: "2026-07-30T06:16:00.000Z",
  updatedAt: "2026-07-30T06:18:00.000Z",
};

const rootSessions = [sourceSession, alternateSourceSession];

const project: OperatorProject = {
  projectId: "moebius",
  sourceType: "local-folder",
  title: "Moebius",
  folderPath: "/Users/example/agent-moebius",
  worktreeMode: true,
  workspaceCwd: "/Users/example/agent-moebius",
  workspaceMode: "worktree",
  worktreePath: "/Users/example/agent-moebius/.worktrees/analysis-panel",
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: "2026-07-30T06:18:00.000Z",
  branchName: "feature/analysis-panel",
  isGitRepository: true,
  directoryAvailable: true,
  sessions: rootSessions,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const messageFragment: ComposerTextFragment = {
  id: "fragment-message",
  label: "文本片段 1",
  text: "[消息 · 产品交付负责人 · “已完成本轮运行”](moebius-ref:message/source/1)",
};

const conversationFragment: ComposerTextFragment = {
  id: "fragment-conversation",
  label: "文本片段 2",
  text: "[对话 · “官网落地页验收”](moebius-ref:conversation/source)",
};

const fragments: ComposerTextFragment[] = [messageFragment, conversationFragment];

const suggestions: NewConversationPromptSuggestion[] = [
  {
    id: "unexpected",
    label: "Agent 运行不符合预期？",
    prompt: "分析这段对话是否符合这个 Agent 团队设计的预期",
  },
  {
    id: "slow",
    label: "Agent 运行太长了？",
    prompt: "分析这段对话为什么占用的时间那么长，主要耗时在哪一块，是否有优化空间",
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
    createdAt: "2026-07-30T06:00:00.000Z",
    updatedAt: "2026-07-30T06:00:00.000Z",
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
      createdAt: "2026-07-30T06:00:10.000Z",
      startedAt: "2026-07-30T06:00:12.000Z",
      elapsedMs: 468_000,
      completedAt: "2026-07-30T06:08:00.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    createdAt: "2026-07-30T06:00:10.000Z",
    updatedAt: "2026-07-30T06:08:00.000Z",
  },
];

const analysisMessages: OperatorMessage[] = [
  {
    id: 11,
    sessionId: analysisSession.sessionId,
    speaker: "user",
    role: null,
    body: [
      "> 来源：",
      "> - [消息 · 产品交付负责人 · “已完成本轮运行”](moebius-ref:message/source-session/2)",
      "",
      "分析这段对话为什么占用的时间那么长，主要耗时在哪一块，是否有优化空间？",
    ].join("\n"),
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-30T06:09:00.000Z",
    updatedAt: "2026-07-30T06:09:00.000Z",
  },
  {
    id: 12,
    sessionId: analysisSession.sessionId,
    speaker: "agent",
    role: "assistant",
    body: [
      "主要耗时集中在多轮产品边界复核，而不是代码执行。",
      "",
      "建议把分析对话从左侧栏移到来源对话自己的分析面板。",
    ].join("\n"),
    status: "displayed",
    runId: "analysis-run",
    runDir: "/tmp/analysis-run",
    error: null,
    runTiming: {
      stepId: "step-analysis",
      attempt: 1,
      createdAt: "2026-07-30T06:09:05.000Z",
      startedAt: "2026-07-30T06:09:06.000Z",
      elapsedMs: 94_000,
      completedAt: "2026-07-30T06:10:40.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    createdAt: "2026-07-30T06:09:05.000Z",
    updatedAt: "2026-07-30T06:10:40.000Z",
  },
];

const nestedMessages: OperatorMessage[] = [
  {
    ...analysisMessages[0]!,
    id: 21,
    sessionId: nestedAnalysisSession.sessionId,
    body: [
      "> 来源：",
      "> - [消息 · 通用助手 · “主要耗时集中在多轮产品边界复核”](moebius-ref:message/analysis-runtime/12)",
      "",
      "检查来源摘录遇到 Markdown 特殊字符时是否稳定。",
    ].join("\n"),
  },
  {
    ...analysisMessages[1]!,
    id: 22,
    sessionId: nestedAnalysisSession.sessionId,
    body: "引用标签只显示安全的可读文本，完整内部地址留在原始 Markdown 中。",
  },
];

const rootPanelEntries: AnalysisPanelEntry[] = [
  { sessionId: roleAnalysisSession.sessionId, title: roleAnalysisSession.title },
  { sessionId: analysisSession.sessionId, title: analysisSession.title },
  {
    sessionId: "analysis-duplicate-a",
    title: "检查角色设计",
    createdLabel: "2026-07-30 14:13:00",
    duplicateLabel: "同名项 A",
  },
  {
    sessionId: "analysis-duplicate-b",
    title: "检查角色设计",
    createdLabel: "2026-07-30 14:13:00",
    duplicateLabel: "同名项 B",
  },
  { sessionId: "analysis-queue", title: "检查待发射队列恢复" },
  { sessionId: "analysis-routing", title: "检查跨树引用路由" },
  { sessionId: "analysis-archive", title: "检查递归归档行为" },
];

const nestedPanelEntries: AnalysisPanelEntry[] = [{
  sessionId: nestedAnalysisSession.sessionId,
  title: nestedAnalysisSession.title,
}];

const analysisSessions = new Map([
  [analysisSession.sessionId, analysisSession],
  [roleAnalysisSession.sessionId, roleAnalysisSession],
  [nestedAnalysisSession.sessionId, nestedAnalysisSession],
]);

const initialAnalysisTab: RightSidebarTab = {
  id: "analysis-runtime-tab",
  type: "conversation",
  title: analysisSession.title,
  sourceKey: `analysis-session:${analysisSession.sessionId}`,
  closable: true,
};

function SessionAnalysisStory({ state }: SessionAnalysisStoryProps): JSX.Element {
  const draftState = state === "draft-single"
    || state === "draft-accumulated"
    || state === "message-menu"
    || state === "conversation-menu"
    || state === "conversation-disabled"
    || state === "project-unavailable";
  const nestedState = state === "nested-panel" || state === "sibling-navigation";
  const projectForState: OperatorProject = state === "project-unavailable"
    ? {
        ...project,
        directoryAvailable: false,
        directoryUnavailableReason: "当前项目本地文件夹未找到，可以指定新的文件夹",
      }
    : state === "conversation-disabled"
      ? {
          ...project,
          sessions: project.sessions.map((session) => session.sessionId === sourceSession.sessionId
            ? { ...session, analysisRecordAvailable: false }
            : session),
        }
      : project;
  const [rightSidebarOpen, setRightSidebarOpen] = useState(draftState || nestedState);
  const [tabs, setTabs] = useState<RightSidebarTabsState>(() => draftState
    ? {
        tabs: [{
          id: "analysis-draft-tab",
          type: "conversation",
          title: "新对话",
          sourceKey: "analysis-draft",
          closable: true,
        }],
        activeTabId: "analysis-draft-tab",
      }
    : nestedState
      ? { tabs: [initialAnalysisTab], activeTabId: initialAnalysisTab.id }
      : EMPTY_RIGHT_SIDEBAR_TABS);
  const [draft, setDraft] = useState("");
  const [draftFragments, setDraftFragments] = useState(
    state === "draft-accumulated" ? fragments : [messageFragment],
  );
  const [createdFromDraft, setCreatedFromDraft] = useState(false);
  const [rootPanelOpen, setRootPanelOpen] = useState(
    state === "panel-empty"
    || state === "panel-loading"
    || state === "panel-failed"
    || state === "panel-multiple",
  );
  const [rootPanelOverride, setRootPanelOverride] = useState<AnalysisPanelState | null>(null);
  const [nestedPanelOpen, setNestedPanelOpen] = useState(nestedState);

  const openAnalysisEntry = (entry: AnalysisPanelEntry): void => {
    const target = analysisSessions.get(entry.sessionId) ?? {
      ...analysisSession,
      sessionId: entry.sessionId,
      title: entry.title,
    };
    setRightSidebarOpen(true);
    setTabs((current) => openRightSidebarSourceTab(current, {
      id: `analysis-tab-${entry.sessionId}`,
      type: "conversation",
      title: target.title,
      sourceKey: `analysis-session:${target.sessionId}`,
    }));
  };

  const rootPanelState = rootPanelOverride ?? panelStateForStory(state);
  const rootPanel: OperatorAnalysisPanelController = {
    open: rootPanelOpen,
    state: rootPanelState,
    onOpenChange: setRootPanelOpen,
    onOpenEntry: openAnalysisEntry,
    onRetry: () => setRootPanelOverride({ status: "ready", entries: rootPanelEntries }),
  };

  return (
    <OperatorConsole
      {...baseConsoleProps(projectForState, sourceSession, sourceMessages)}
      navigationSessionId={sourceSession.sessionId}
      analysisPanel={rootPanel}
      rightSidebarOpen={rightSidebarOpen}
      rightSidebarWidth={520}
      rightSidebarTabs={tabs}
      onRightSidebarOpenChange={setRightSidebarOpen}
      onRightSidebarTabsChange={setTabs}
      onAnalyzeSession={() => undefined}
      onAnalyzeConversation={() => undefined}
      rightSidebarContentSlots={{
        conversation: (tab) => (
          <div className="flex h-full min-h-0">
            {tab.sourceKey === "analysis-draft" && !createdFromDraft ? (
              <NewConversationPage
                projects={[{
                  projectId: projectForState.projectId,
                  title: projectForState.title,
                  available: projectForState.directoryAvailable !== false,
                  independentWorkspaceAvailable: true,
                  branchLabel: projectForState.branchName ?? "—",
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
                selectedProjectId={projectForState.projectId}
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
                    tabs: current.tabs.map((candidate) => candidate.id === tab.id
                      ? {
                          ...candidate,
                          title: analysisSession.title,
                          sourceKey: `analysis-session:${analysisSession.sessionId}`,
                        }
                      : candidate),
                  }));
                }}
              />
            ) : (
              renderAnalysisConversation({
                tab,
                project: projectForState,
                draft,
                nestedPanelOpen,
                setNestedPanelOpen,
                openAnalysisEntry,
              })
            )}
          </div>
        ),
      }}
    />
  );
}

function renderAnalysisConversation({
  tab,
  project: selectedProject,
  draft,
  nestedPanelOpen,
  setNestedPanelOpen,
  openAnalysisEntry,
}: {
  tab: RightSidebarTab;
  project: OperatorProject;
  draft: string;
  nestedPanelOpen: boolean;
  setNestedPanelOpen(open: boolean): void;
  openAnalysisEntry(entry: AnalysisPanelEntry): void;
}): JSX.Element {
  const sessionId = tab.sourceKey?.replace(/^analysis-session:/u, "") ?? analysisSession.sessionId;
  const session = analysisSessions.get(sessionId) ?? {
    ...analysisSession,
    sessionId,
    title: tab.title,
  };
  const isNested = session.sessionId === nestedAnalysisSession.sessionId;
  const messages = isNested
    ? nestedMessages
    : draft.trim() === ""
      ? analysisMessages
      : [{ ...analysisMessages[0]!, body: draft }, analysisMessages[1]!];
  const panel = session.sessionId === analysisSession.sessionId
    ? {
        open: nestedPanelOpen,
        state: { status: "ready", entries: nestedPanelEntries } as AnalysisPanelState,
        onOpenChange: setNestedPanelOpen,
        onOpenEntry: openAnalysisEntry,
      }
    : {
        open: false,
        state: { status: "ready", entries: [] } as AnalysisPanelState,
        onOpenChange: () => undefined,
        onOpenEntry: openAnalysisEntry,
      };

  return (
    <OperatorConsole
      {...baseConsoleProps(selectedProject, session, messages)}
      presentation="conversation"
      analysisPanel={panel}
      onAnalyzeConversation={() => undefined}
    />
  );
}

function panelStateForStory(state: SessionAnalysisState): AnalysisPanelState {
  if (state === "panel-loading") {
    return { status: "loading" };
  }
  if (state === "panel-failed") {
    return { status: "failed" };
  }
  if (state === "panel-empty") {
    return { status: "ready", entries: [] };
  }
  return { status: "ready", entries: rootPanelEntries };
}

function baseConsoleProps(
  selectedProject: OperatorProject,
  selectedSession: OperatorSession,
  messages: OperatorMessage[],
): OperatorConsoleProps {
  return {
    project: selectedProject,
    projects: [selectedProject],
    selectedProjectId: selectedProject.projectId,
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

export const RootPanelClosed: Story = {
  args: { state: "panel-closed" },
};

export const RootPanelMultipleEntries: Story = {
  args: { state: "panel-multiple" },
};

export const RootPanelEmpty: Story = {
  args: { state: "panel-empty" },
};

export const RootPanelLoading: Story = {
  args: { state: "panel-loading" },
};

export const RootPanelFailed: Story = {
  args: { state: "panel-failed" },
};

export const NarrowPanelOverlay: Story = {
  args: { state: "panel-multiple" },
  parameters: {
    viewport: {
      defaultViewport: "mobile2",
    },
  },
};

export const AnalysisConversationOwnPanel: Story = {
  args: { state: "nested-panel" },
};

export const DirectChildOpensAsSiblingTab: Story = {
  args: { state: "sibling-navigation" },
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('button[aria-label="检查消息引用转义"]')
      ?.click();
  },
};

export const AnalysisDraftSingleFragment: Story = {
  args: { state: "draft-single" },
};

export const AnalysisDraftAccumulatedFragments: Story = {
  args: { state: "draft-accumulated" },
};

export const MessageMenu: Story = {
  args: { state: "message-menu" },
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLElement>('[data-testid="timeline-message-2"] [tabindex="0"]')
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  },
};

export const ConversationMenu: Story = {
  args: { state: "conversation-menu" },
  play: async ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLElement>('[data-testid="conversation-sidebar-session"][data-session-id="source-session"]')
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  },
};

export const ConversationMenuRecordUnavailable: Story = {
  args: { state: "conversation-disabled" },
  play: ConversationMenu.play,
};

export const ConversationMenuProjectUnavailable: Story = {
  args: { state: "project-unavailable" },
  play: ConversationMenu.play,
};
