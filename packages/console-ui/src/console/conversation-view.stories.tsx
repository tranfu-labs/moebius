import type { Meta, StoryObj } from "@storybook/react";

import {
  OperatorConsole,
  type OperatorConsoleProps,
  type OperatorMessage,
} from "@/console/operator-console";
import type { ProcessStep } from "@/console/process-trail";

/**
 * 点头像弹出的运行信息：这一步实际用的成员、团队与执行配置。
 * 按 runId 查，让每个头像给出的是它自己那次运行的事实。
 */
const runAgentFacts: Record<string, {
  role: string;
  displayName: string;
  description: string;
  profile: { cli: "codex" | "claude" | "kimi"; model: string; effort: string };
  evidence: "executed" | "planned-not-started";
}> = {
  "run-1": { role: "pm", displayName: "交付负责人", description: "统筹交付", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" }, evidence: "executed" },
  "run-2": { role: "dev", displayName: "开发", description: "生产实现", profile: { cli: "claude", model: "sonnet", effort: "high" }, evidence: "executed" },
  "run-3": { role: "qa", displayName: "测试", description: "功能验证", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" }, evidence: "executed" },
  "run-4": { role: "qa", displayName: "测试", description: "功能验证", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" }, evidence: "executed" },
  "run-5": { role: "release", displayName: "发布", description: "发布收尾", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "low" }, evidence: "executed" },
  "run-stuck": { role: "reviewer", displayName: "交付审查员", description: "交付前复核", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" }, evidence: "executed" },
  "run-stopped": { role: "dev", displayName: "开发", description: "生产实现", profile: { cli: "claude", model: "sonnet", effort: "high" }, evidence: "executed" },
  "run-failed": { role: "qa", displayName: "测试", description: "功能验证", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" }, evidence: "planned-not-started" },
};

const loadRunAgentInfo: OperatorConsoleProps["onLoadRunAgentInfo"] = async ({ sessionId, runId }) => {
  const fact = runAgentFacts[runId];
  return {
    sessionId,
    runId,
    role: fact?.role ?? null,
    agent: {
      slug: fact?.role ?? "unknown",
      displayName: fact?.displayName ?? null,
      description: fact?.description ?? null,
    },
    team: { name: "研发团队", ownership: "system" as const, sourceName: "Moebius" },
    profile: fact?.profile ?? null,
    loadedAt: "2026-07-11T10:00:00.000Z",
    evidence: fact?.evidence ?? "bound-start-unknown",
  };
};

const loadRunAgentMarkdown: OperatorConsoleProps["onLoadRunAgentMarkdown"] = async ({ runId }) => ({
  markdown: `# ${runAgentFacts[runId]?.displayName ?? "成员"}\n\n${runAgentFacts[runId]?.description ?? "这次运行没有留下角色说明。"}`,
});

const devTrail: ProcessStep[] = [
  { id: "d1", kind: "thinking", title: "先确认构建能过，再看两处细节", status: "done" },
  { id: "d2", kind: "command", title: "pnpm --filter marketing-site build", detail: "退出码 0", status: "done" },
  { id: "d3", kind: "file", title: "读取 index.astro", status: "done" },
  { id: "d4", kind: "file", title: "读取 share-card.tsx", status: "done" },
  { id: "d5", kind: "search", title: "搜索标题截断逻辑", detail: "3 处命中", status: "done" },
];

const releaseTrail: ProcessStep[] = [
  { id: "r1", kind: "thinking", title: "确认版本号与 changelog 是否齐了", status: "done" },
  { id: "r2", kind: "command", title: "git tag v0.4.3", status: "done" },
  { id: "r3", kind: "tool", title: "生成 changelog", status: "running" },
];

const pmMarkdown = [
  "## 计划",
  "按两条线检查：",
  "",
  "- 首页文案——措辞与英文版一致性",
  "- 分享卡片——OG 图与标题截断",
  "",
  "交棒：@dev 先跑构建与截图",
].join("\n");

const devMarkdown = [
  "## 结论",
  "构建通过，两处待确认。",
  "",
  "## 依据",
  "- sites/marketing/src/pages/index.astro",
  "- sites/marketing/src/components/share-card.tsx",
  "",
  "```bash",
  "pnpm --filter marketing-site build",
  "```",
  "",
  "## 下一步",
  "交棒：@qa 按验收场景走查分享卡片",
  "",
  "<!-- moebius:stage=code-verified -->",
].join("\n");

const qaMarkdown = [
  "## 验收结果",
  "",
  "| 场景 | 结果 |",
  "| --- | --- |",
  "| 分享卡片标题 ≤ 40 字 | 通过 |",
  "| OG 图 1200×630 | 通过 |",
  "",
  "交棒：@release 可以发布",
].join("\n");

const messages: OperatorMessage[] = [
  {
    id: 1,
    sessionId: "review",
    speaker: "user",
    role: null,
    body: "请对 marketing-site 做一轮发布前检查，重点是首页文案和分享卡片。",
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
  },
  {
    id: 2,
    sessionId: "review",
    speaker: "agent",
    role: "pm",
    body: pmMarkdown,
    status: "displayed",
    runId: "run-1",
    runTiming: {
      stepId: "step-1",
      attempt: 1,
      createdAt: "2026-07-11T10:01:00.000Z",
      startedAt: "2026-07-11T10:01:00.000Z",
      elapsedMs: 62000,
      completedAt: "2026-07-11T10:02:02.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    runDir: "/tmp/review-run-1",
    error: null,
    createdAt: "2026-07-11T10:01:00.000Z",
    updatedAt: "2026-07-11T10:02:00.000Z",
  },
  {
    id: 3,
    sessionId: "review",
    speaker: "agent",
    role: "dev",
    processSteps: devTrail,
    body: devMarkdown,
    status: "displayed",
    runId: "run-2",
    runTiming: {
      stepId: "step-2",
      attempt: 1,
      createdAt: "2026-07-11T10:03:00.000Z",
      startedAt: "2026-07-11T10:03:00.000Z",
      elapsedMs: 181000,
      completedAt: "2026-07-11T10:06:01.000Z",
      status: "completed",
      engine: "claude",
      processOutputAvailable: true,
    },
    runDir: "/tmp/review-run-2",
    error: null,
    createdAt: "2026-07-11T10:03:00.000Z",
    updatedAt: "2026-07-11T10:06:00.000Z",
  },
  {
    id: 4,
    sessionId: "review",
    speaker: "agent",
    role: "qa",
    body: "开始走查分享卡片……",
    status: "failed",
    runId: "run-3",
    runTiming: {
      stepId: "step-3",
      attempt: 1,
      createdAt: "2026-07-11T10:07:00.000Z",
      startedAt: "2026-07-11T10:07:00.000Z",
      elapsedMs: 119000,
      completedAt: "2026-07-11T10:08:59.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    runDir: "/tmp/review-run-3",
    error: "Playwright 启动超时（120s）",
    createdAt: "2026-07-11T10:07:00.000Z",
    updatedAt: "2026-07-11T10:09:00.000Z",
  },
  {
    id: 5,
    sessionId: "review",
    speaker: "user",
    role: null,
    body: "重试一下，只跑分享卡片那部分。",
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-11T10:10:00.000Z",
    updatedAt: "2026-07-11T10:10:00.000Z",
  },
  {
    id: 6,
    sessionId: "review",
    speaker: "agent",
    role: "qa",
    body: qaMarkdown,
    status: "displayed",
    runId: "run-4",
    runTiming: {
      stepId: "step-4",
      attempt: 1,
      createdAt: "2026-07-11T10:11:00.000Z",
      startedAt: "2026-07-11T10:11:00.000Z",
      elapsedMs: 154000,
      completedAt: "2026-07-11T10:13:34.000Z",
      status: "completed",
      engine: "codex",
      processOutputAvailable: true,
    },
    runDir: "/tmp/review-run-4",
    error: null,
    createdAt: "2026-07-11T10:11:00.000Z",
    updatedAt: "2026-07-11T10:14:00.000Z",
  },
];

const session: OperatorConsoleProps["selectedSession"] = {
  sessionId: "review",
  projectId: "local",
  workspaceMode: "worktree",
  workspacePendingMode: null,
  title: "发布前检查",
  status: "running",
  awaitsHumanReason: null,
  unreadSince: null,
  runningCount: 1,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  createdAt: "2026-07-11T10:00:00.000Z",
  updatedAt: "2026-07-11T10:14:00.000Z",
  agentTeamOwnership: "system",
  agentTeamId: "development",
  agentTeamHealth: "usable",
  agentTeamSnapshot: {
    team: {
      ownership: "system",
      id: "development",
      name: "研发团队",
      description: "发布前检查所用的研发团队。",
      primaryAgentSlug: "pm",
      officialSourceName: "Moebius",
    },
    members: [
      { name: "pm", displayName: "交付负责人", description: "统筹交付" },
      { name: "dev", displayName: "开发", description: "生产实现" },
      { name: "qa", displayName: "测试", description: "功能验证" },
      { name: "release", displayName: "发布", description: "发布收尾" },
    ],
    loadedAt: "2026-07-11T10:00:00.000Z",
  },
};

const sample: OperatorConsoleProps = {
  presentation: "conversation",
  project: {
    projectId: "local",
    sourceType: "local-folder",
    title: "moebius",
    folderPath: "/Users/example/moebius",
    worktreeMode: true,
    workspaceCwd: "/tmp/review-cwd",
    workspaceMode: "worktree",
    worktreePath: "/tmp/review-worktree",
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: "2026-07-11T10:14:00.000Z",
    sessions: [session],
    runningCount: 1,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  },
  selectedProjectId: "local",
  selectedSessionId: "review",
  selectedSession: session,
  messages,
  activeRun: {
    sessionId: "review",
    runId: "run-5",
    role: "release",
    status: "running",
    startedAt: "2026-07-11T10:15:00.000Z",
    elapsedMs: 47_000,
    runDir: "/tmp/review-run-5",
    cwd: "/tmp/review-cwd",
    workspaceMode: "worktree",
    worktreeUnavailableReason: null,
    stdoutTail: "pushing tag v0.4.3",
    stderrTail: null,
    liveMarkdown: "## 正在发布\n\n- 生成 changelog\n- 推送 tag",
    processSteps: releaseTrail,
    lastOutputSummary: "正在发布",
    tailDiagnostic: null,
    interruptible: true,
  },
  memberIdentities: [
    { slug: "pm", displayName: "交付负责人", engine: { cli: "codex" } },
    { slug: "dev", displayName: "开发", engine: { cli: "claude" } },
    { slug: "qa", displayName: "测试", engine: { cli: "codex" } },
    { slug: "release", displayName: "发布", engine: { cli: "codex" } },
    { slug: "reviewer", displayName: "交付审查员", engine: { cli: "codex" } },
  ],
  composerValue: "",
  onLoadRunAgentInfo: loadRunAgentInfo,
  onLoadRunAgentMarkdown: loadRunAgentMarkdown,
  onRetryRun: () => undefined,
  onAnalyzeConversation: () => undefined,
  onOpenEvidence: () => undefined,
  onComposerChange: () => undefined,
  onSend: () => undefined,
  onSelectSession: () => undefined,
  onInterrupt: () => undefined,
};

const meta = {
  title: "Block/Console/ConversationView",
  component: OperatorConsole,
  args: sample,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OperatorConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RelayRunning: Story = {};

/** 主运行的「停下」在输入框；成员运行的「停下」长在它自己的运行块上。 */
export const MemberRunStoppable: Story = {
  args: {
    activeRuns: [
      sample.activeRun!,
      {
        ...sample.activeRun!,
        runId: "run-6",
        role: "qa",
        liveMarkdown: "## 正在复跑分享卡片\n\n- 截图对比中",
        lastOutputSummary: "正在复跑分享卡片",
        elapsedMs: 12_000,
        processSteps: [
          { id: "q1", kind: "thinking", title: "只跑分享卡片这一段", status: "done" },
          { id: "q2", kind: "tool", title: "截图对比", status: "running" },
        ],
      },
    ],
  },
};

export const RelayIdle: Story = {
  args: {
    activeRun: null,
    selectedSession: { ...session, status: "waiting", awaitsHumanReason: "acceptance", runningCount: 0, waitingCount: 1 },
  },
};

const outcomeMessages: OperatorMessage[] = [
  {
    id: 1,
    sessionId: "review",
    speaker: "user",
    role: null,
    body: "继续做发布前检查。",
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
  },
  {
    id: 2,
    sessionId: "review",
    speaker: "system",
    role: "reviewer",
    body: "这一步卡住了。你可以直接告诉主理人下一步怎么处理。",
    status: "stuck",
    systemEventKind: "run-stuck",
    terminal: {
      kind: "timeout",
      subkind: null,
      safeCode: null,
      retryable: true,
      partialMarkdown: [
        "## 已核对",
        "",
        "- 首页 hero 文案与英文版一致",
        "- 分享卡片标题在 40 字以内",
        "",
        "正在核对 OG 图尺寸……",
      ].join("\n"),
      contentIncomplete: true,
      actualProfile: null,
    },
    runTiming: {
      stepId: "step-stuck",
      attempt: 1,
      createdAt: "2026-07-11T10:00:13.000Z",
      startedAt: "2026-07-11T10:00:13.000Z",
      elapsedMs: 767_000,
      completedAt: "2026-07-11T10:13:00.000Z",
      status: "stuck",
      engine: "codex",
      processOutputAvailable: false,
    },
    runId: "run-stuck",
    runDir: "/tmp/review-run-stuck",
    error: null,
    createdAt: "2026-07-11T10:13:00.000Z",
    updatedAt: "2026-07-11T10:13:00.000Z",
  },
  {
    id: 3,
    sessionId: "review",
    speaker: "system",
    role: "dev",
    body: "你让这一步停下了。已经产生的文件改动会保留。",
    status: "interrupted",
    systemEventKind: "user-stopped",
    terminal: {
      kind: "interrupted",
      subkind: "user",
      safeCode: null,
      retryable: true,
      partialMarkdown: [
        "## 打算这么改",
        "",
        "把 `share-card.tsx` 的标题截断从 40 字放宽到 56 字，并",
      ].join("\n"),
      contentIncomplete: true,
      actualProfile: null,
    },
    runTiming: {
      stepId: "step-stopped",
      attempt: 1,
      createdAt: "2026-07-11T10:14:00.000Z",
      startedAt: "2026-07-11T10:14:00.000Z",
      elapsedMs: 121_000,
      completedAt: "2026-07-11T10:16:00.000Z",
      status: "interrupted",
      engine: "claude",
      processOutputAvailable: false,
    },
    runId: "run-stopped",
    runDir: "/tmp/review-run-stopped",
    error: null,
    createdAt: "2026-07-11T10:16:00.000Z",
    updatedAt: "2026-07-11T10:16:00.000Z",
  },
  {
    id: 4,
    sessionId: "review",
    speaker: "system",
    role: "qa",
    body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
    status: "failed",
    systemEventKind: "run-not-started",
    runId: "run-failed",
    runDir: null,
    error: null,
    createdAt: "2026-07-11T10:18:00.000Z",
    updatedAt: "2026-07-11T10:18:00.000Z",
  },
];

const headerlessFailure: OperatorMessage = {
  id: 5,
  sessionId: "review",
  speaker: "system",
  role: null,
  body: "",
  status: "failed",
  systemEventKind: "other",
  terminal: {
    kind: "crashed",
    subkind: null,
    safeCode: null,
    retryable: true,
    partialMarkdown: "",
    contentIncomplete: true,
    actualProfile: null,
  },
  runTiming: {
    stepId: "step-crashed",
    attempt: 1,
    createdAt: "2026-07-11T10:19:00.000Z",
    startedAt: "2026-07-11T10:19:00.000Z",
    elapsedMs: 38_000,
    completedAt: "2026-07-11T10:19:38.000Z",
    status: "failed",
    engine: "codex",
    processOutputAvailable: false,
  },
  runId: "run-crashed",
  runDir: null,
  error: null,
  createdAt: "2026-07-11T10:19:38.000Z",
  updatedAt: "2026-07-11T10:19:38.000Z",
};

export const RunOutcomes: Story = {
  args: {
    messages: [...outcomeMessages, headerlessFailure],
    activeRun: null,
    selectedSession: { ...session, status: "stuck", runningCount: 0, stuckCount: 1 },
  },
};
