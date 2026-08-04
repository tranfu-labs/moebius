/**
 * 团队版本、变化提示与「应用」流程的确定性 fixture 与纯逻辑。
 * 对应 docs/product/pages/main-conversation.md（团队按钮展开、变化提示、
 * 头像信息卡）与 docs/product/pages/agent-teams.md（保存后的生效反馈）。
 * 设计原型专用，非正式产品实现；数据全部为本地虚构 fixture。
 */

export type MemberTone = "indigo" | "violet" | "amber" | "cyan" | "user";

export interface TeamMember {
  slug: string;
  displayName: string;
  tone: MemberTone;
  cli: string;
  model: string;
  effort: string | null;
  agentMarkdown: string;
}

export interface Team {
  id: string;
  name: string;
  source: "official" | "user";
  /** 官方团队不随改名变化的内置来源名称（产品文案，非内部标识）。 */
  builtinName?: string;
  /** 用户团队的稳定本地创建时间（可读文本）。 */
  createdAt?: string;
  purpose: string;
  primarySlug: string;
  members: TeamMember[];
}

/** 会话冻结的团队快照：名称、来源、用途、成员与运行配置全部冻结。 */
export interface TeamSnapshot {
  /** 快照建立时对应的团队，用于菜单中避免重复列出。 */
  teamId: string;
  teamName: string;
  source: "official" | "user";
  builtinName?: string;
  createdAt?: string;
  purpose: string;
  primarySlug: string;
  members: TeamMember[];
  loadedAt: string;
}

/* ------------------------------------------------------------------ */
/* fixture：当前已保存的团队目录                                       */
/* ------------------------------------------------------------------ */

const CURRENT_LEAD: TeamMember = {
  slug: "delivery-lead",
  displayName: "交付经理",
  tone: "indigo",
  cli: "Codex",
  model: "gpt-5.6-sol",
  effort: "high",
  agentMarkdown: [
    "# 交付经理",
    "",
    "你是交付团队的主 Agent，对一轮会话拥有编排与收尾责任。",
    "",
    "## 职责",
    "- 拆解用户目标并分派给合适的成员。",
    "- 汇总专业结论，决定继续派工、询问用户或收尾。",
    "",
    "## 协作",
    "- 实现交给 @dev，验证交给 @qa。",
    "- 争议先收集意见，再给出明确裁决。"
  ].join("\n")
};

const CURRENT_DEV: TeamMember = {
  slug: "dev",
  displayName: "开发工程师",
  tone: "violet",
  cli: "Codex",
  model: "gpt-5.6-sol",
  effort: "high",
  agentMarkdown: [
    "# 开发工程师",
    "",
    "负责软件方案、实现与小步重构。",
    "",
    "## 边界",
    "- 改动保持最小，不顺手清理无关代码。",
    "- 完成后把验证交给 @qa。"
  ].join("\n")
};

const CURRENT_QA: TeamMember = {
  slug: "qa",
  displayName: "测试工程师",
  tone: "amber",
  cli: "Claude Code",
  model: "claude-sonnet-4.6",
  effort: "medium",
  agentMarkdown: [
    "# 测试工程师",
    "",
    "负责行为级验证与回归判断。",
    "",
    "## 方法",
    "- 只测行为，不镜像实现措辞。",
    "- 红了先定位根因，再决定是否返工。"
  ].join("\n")
};

const CURRENT_SECURITY: TeamMember = {
  slug: "security",
  displayName: "安全审查",
  tone: "cyan",
  cli: "Kimi",
  model: "k2.5",
  effort: "low",
  agentMarkdown: [
    "# 安全审查",
    "",
    "审查改动的安全边界：命令执行、外部输入与凭据处理。"
  ].join("\n")
};

const CURRENT_DOCS: TeamMember = {
  slug: "docs",
  displayName: "文档专员",
  tone: "user",
  cli: "Codex",
  model: "gpt-5.6-mini",
  effort: "low",
  agentMarkdown: "# 文档专员\n\n维护事实源文档，与实现同 commit 更新。"
};

const CURRENT_RELEASE: TeamMember = {
  slug: "release",
  displayName: "发布专员",
  tone: "indigo",
  cli: "Claude Code",
  model: "claude-sonnet-4.6",
  effort: "medium",
  agentMarkdown: "# 发布专员\n\n负责打包、签名与发布校验。"
};

/** 当前会话所属团队：已从快照里的「开发团队」改名为「交付团队」，并新增两名成员。 */
export const DELIVERY_TEAM: Team = {
  id: "team-delivery",
  name: "交付团队",
  source: "official",
  builtinName: "内置：交付团队",
  purpose: "负责软件方案、实现、测试与复核",
  primarySlug: "delivery-lead",
  members: [
    CURRENT_LEAD,
    CURRENT_DEV,
    CURRENT_QA,
    CURRENT_SECURITY,
    CURRENT_DOCS,
    CURRENT_RELEASE
  ]
};

/** 与官方团队同名的用户团队，用于同名辨认。 */
export const USER_DELIVERY_TEAM: Team = {
  id: "team-delivery-copy",
  name: "交付团队",
  source: "user",
  createdAt: "创建于 2026-07-29 14:32:05",
  purpose: "从官方团队复制的个人调改版",
  primarySlug: "dev",
  members: [CURRENT_LEAD, CURRENT_DEV, CURRENT_QA]
};

export const GENERAL_TEAM: Team = {
  id: "team-general",
  name: "通用助手",
  source: "official",
  builtinName: "内置：通用助手",
  purpose: "处理一般对话与任务",
  primarySlug: "assistant",
  members: [
    {
      slug: "assistant",
      displayName: "通用助手",
      tone: "user",
      cli: "Codex",
      model: "gpt-5.6-sol",
      effort: "medium",
      agentMarkdown: "# 通用助手\n\n处理一般对话与任务。"
    }
  ]
};

export const MARKETING_TEAM: Team = {
  id: "team-marketing",
  name: "营销团队",
  source: "user",
  createdAt: "创建于 2026-07-20 09:05:41",
  purpose: "官网文案、发布说明与传播素材",
  primarySlug: "marketing-lead",
  members: [
    {
      slug: "marketing-lead",
      displayName: "营销经理",
      tone: "amber",
      cli: "Codex",
      model: "gpt-5.6-sol",
      effort: "medium",
      agentMarkdown: "# 营销经理\n\n统筹官网与发布内容。"
    },
    {
      slug: "copywriter",
      displayName: "文案",
      tone: "violet",
      cli: "Kimi",
      model: "k2.5",
      effort: "low",
      agentMarkdown: "# 文案\n\n撰写中文产品文案。"
    },
    {
      slug: "visual",
      displayName: "视觉",
      tone: "cyan",
      cli: "Claude Code",
      model: "claude-sonnet-4.6",
      effort: "medium",
      agentMarkdown: "# 视觉\n\n产出截图与视觉素材。"
    }
  ]
};

export const TEAM_CATALOG: Team[] = [
  DELIVERY_TEAM,
  USER_DELIVERY_TEAM,
  GENERAL_TEAM,
  MARKETING_TEAM
];

/* ------------------------------------------------------------------ */
/* fixture：当前会话冻结的历史快照（旧名称、旧成员构成、旧运行配置）   */
/* ------------------------------------------------------------------ */

const SNAPSHOT_LEAD: TeamMember = {
  ...CURRENT_LEAD,
  model: "gpt-5.5",
  effort: "medium",
  agentMarkdown: [
    "# 交付经理",
    "",
    "你是开发团队的主 Agent，负责分派与收尾。",
    "",
    "## 协作",
    "- 实现交给 @dev，验证交给 @qa。"
  ].join("\n")
};

const SNAPSHOT_DEV: TeamMember = {
  ...CURRENT_DEV,
  model: "gpt-5.5",
  agentMarkdown: [
    "# 开发工程师",
    "",
    "负责实现。完成后把验证交给 @qa。"
  ].join("\n")
};

const SNAPSHOT_QA: TeamMember = {
  ...CURRENT_QA,
  model: "claude-sonnet-4.5",
  agentMarkdown: "# 测试工程师\n\n负责验证。"
};

const SNAPSHOT_SECURITY: TeamMember = { ...CURRENT_SECURITY };

export const SESSION_SNAPSHOT: TeamSnapshot = {
  teamId: DELIVERY_TEAM.id,
  teamName: "开发团队",
  source: "official",
  builtinName: "内置：交付团队",
  purpose: "负责软件实现与测试",
  primarySlug: "delivery-lead",
  members: [SNAPSHOT_LEAD, SNAPSHOT_DEV, SNAPSHOT_QA, SNAPSHOT_SECURITY],
  loadedAt: "2026-08-02 09:14"
};

/* ------------------------------------------------------------------ */
/* 团队身份辨认                                                        */
/* ------------------------------------------------------------------ */

export interface TeamIdentityLike {
  name: string;
  source: "official" | "user";
  builtinName?: string;
  createdAt?: string;
}

export function sourceLabel(source: "official" | "user"): string {
  return source === "official" ? "官方来源" : "用户团队";
}

/**
 * 与 PRD 的同名辨认规则一致：先名称＋来源；名称与来源都相同时，
 * 官方团队追加内置来源名称，用户团队追加创建时间。
 */
export function identityLabel(
  identity: TeamIdentityLike,
  peers: TeamIdentityLike[]
): string {
  const base = `${identity.name} · ${sourceLabel(identity.source)}`;
  const extraOf = (entry: TeamIdentityLike) =>
    entry.source === "official" ? entry.builtinName : entry.createdAt;
  const collides = peers.some(
    (peer) =>
      peer.name === identity.name &&
      peer.source === identity.source &&
      extraOf(peer) !== extraOf(identity)
  );
  if (!collides) return base;
  const extra = extraOf(identity);
  return extra ? `${base} · ${extra}` : base;
}

export function snapshotIdentity(snapshot: TeamSnapshot): TeamIdentityLike {
  return {
    name: snapshot.teamName,
    source: snapshot.source,
    builtinName: snapshot.builtinName,
    createdAt: snapshot.createdAt
  };
}

export function teamIdentity(team: Team): TeamIdentityLike {
  return {
    name: team.name,
    source: team.source,
    builtinName: team.builtinName,
    createdAt: team.createdAt
  };
}

export function memberBySlug(
  members: TeamMember[],
  slug: string
): TeamMember | undefined {
  return members.find((member) => member.slug === slug);
}

/* ------------------------------------------------------------------ */
/* 变化检测：快照 vs 当前已保存团队                                    */
/* ------------------------------------------------------------------ */

export interface ChangeSet {
  /** `AGENT.md` 有已保存变化的成员数量。 */
  agentDefinition: number;
  /** CLI / model / effort 有已保存变化的成员数量。 */
  runtimeConfig: number;
  /** 团队名称、用途、主 Agent 或成员构成是否变化。 */
  teamInfo: boolean;
}

export function detectChanges(
  snapshot: TeamSnapshot,
  team: Team
): ChangeSet {
  let agentDefinition = 0;
  let runtimeConfig = 0;

  for (const current of team.members) {
    const frozen = memberBySlug(snapshot.members, current.slug);
    if (!frozen) continue;
    if (frozen.agentMarkdown !== current.agentMarkdown) agentDefinition += 1;
    if (
      frozen.cli !== current.cli ||
      frozen.model !== current.model ||
      frozen.effort !== current.effort
    ) {
      runtimeConfig += 1;
    }
  }

  const frozenSlugs = new Set(snapshot.members.map((member) => member.slug));
  const currentSlugs = new Set(team.members.map((member) => member.slug));
  const membershipChanged =
    frozenSlugs.size !== currentSlugs.size ||
    [...currentSlugs].some((slug) => !frozenSlugs.has(slug));

  const teamInfo =
    snapshot.teamName !== team.name ||
    snapshot.purpose !== team.purpose ||
    snapshot.primarySlug !== team.primarySlug ||
    membershipChanged;

  return { agentDefinition, runtimeConfig, teamInfo };
}

export function hasAnyChange(changes: ChangeSet): boolean {
  return (
    changes.agentDefinition > 0 ||
    changes.runtimeConfig > 0 ||
    changes.teamInfo
  );
}

/* ------------------------------------------------------------------ */
/* 快照构建                                                            */
/* ------------------------------------------------------------------ */

export function snapshotFromTeam(team: Team, loadedAt: string): TeamSnapshot {
  return {
    teamId: team.id,
    teamName: team.name,
    source: team.source,
    builtinName: team.builtinName,
    createdAt: team.createdAt,
    purpose: team.purpose,
    primarySlug: team.primarySlug,
    members: team.members.map((member) => ({ ...member })),
    loadedAt
  };
}

/* ------------------------------------------------------------------ */
/* 「应用」状态机                                                      */
/*                                                                     */
/* idle    —— 分类提示可见，未请求应用                                 */
/* pending —— 已冻结点击时的完整团队版本，等待旧 run 与旧队列结束       */
/* failed  —— 落盘或读取失败；保留冻结目标，可重试或取消               */
/* applied —— 新快照生效，覆盖到的提示消失                             */
/* ------------------------------------------------------------------ */

export interface QueuedMessage {
  id: string;
  text: string;
}

export type ApplyState =
  | { phase: "idle" }
  | { phase: "pending"; frozen: Team; queue: QueuedMessage[] }
  | { phase: "failed"; frozen: Team; queue: QueuedMessage[]; reason: string }
  | { phase: "applied" };

export const IDLE_APPLY: ApplyState = { phase: "idle" };

/** 点击任一「应用」：先冻结此刻读取到的完整团队版本，后续保存不影响它。 */
export function requestApply(team: Team, hasOldWork: boolean): ApplyState {
  if (hasOldWork) {
    return { phase: "pending", frozen: cloneTeam(team), queue: [] };
  }
  return { phase: "applied" };
}

export function cloneTeam(team: Team): Team {
  return { ...team, members: team.members.map((member) => ({ ...member })) };
}

/** 旧工作全部结束后尝试落盘生效。 */
export function settlePending(
  state: ApplyState,
  outcome: "success" | "failure",
  reason?: string
): ApplyState {
  if (state.phase !== "pending") return state;
  if (outcome === "success") return { phase: "applied" };
  return {
    phase: "failed",
    frozen: state.frozen,
    queue: state.queue,
    reason: reason ?? "目标版本读取失败，未应用"
  };
}

/** 「重试应用」只重试第一次点击时冻结的同一完整版本。 */
export function retryApply(state: ApplyState): ApplyState {
  if (state.phase !== "failed") return state;
  return { phase: "pending", frozen: state.frozen, queue: state.queue };
}

/**
 * 「取消应用并继续使用当前版本」：放弃冻结目标，
 * 等待中的消息按原 FIFO 用当前旧快照继续发射。
 */
export function cancelApply(state: ApplyState): {
  state: ApplyState;
  released: QueuedMessage[];
} {
  if (state.phase !== "pending" && state.phase !== "failed") {
    return { state, released: [] };
  }
  return { state: { phase: "idle" }, released: state.queue };
}

/** 点击「应用」之后发送的消息等待新快照生效，可编辑、可移除。 */
export function enqueueWaitingMessage(
  state: ApplyState,
  message: QueuedMessage
): ApplyState {
  if (state.phase !== "pending" && state.phase !== "failed") return state;
  return { ...state, queue: [...state.queue, message] };
}

export function removeWaitingMessage(
  state: ApplyState,
  id: string
): ApplyState {
  if (state.phase !== "pending" && state.phase !== "failed") return state;
  return { ...state, queue: state.queue.filter((item) => item.id !== id) };
}

/* ------------------------------------------------------------------ */
/* 头像信息卡 fixture：三种配置事实证明层级                            */
/* ------------------------------------------------------------------ */

export type ConfigProvenance =
  | { kind: "executed" } // 实际执行配置：有可信外部执行开始证据
  | { kind: "planned" } // 本次计划尝试 · 未开始执行：启动前失败
  | { kind: "bound" }; // 本次绑定配置 · 是否开始未记录：旧历史

export interface AgentRecord {
  id: string;
  memberSlug: string;
  time: string;
  outcome: "success" | "failed-before-start" | "legacy";
  provenance: ConfigProvenance;
  /** 该 run 冻结的运行配置；旧历史缺失字段为 null → 「此项未记录」。 */
  cli: string;
  model: string | null;
  effort: string | null;
  summary: string;
}

export function provenanceLabel(provenance: ConfigProvenance): string {
  if (provenance.kind === "executed") return "实际执行配置";
  if (provenance.kind === "planned") return "本次计划尝试 · 未开始执行";
  return "本次绑定配置 · 是否开始未记录";
}

export const AGENT_RECORDS: AgentRecord[] = [
  {
    id: "run-dev",
    memberSlug: "dev",
    time: "14:02",
    outcome: "success",
    provenance: { kind: "executed" },
    cli: "Codex",
    model: "gpt-5.5",
    effort: "high",
    summary:
      "已按评审意见收口团队选择器的成员收敛规则，＋N 展开不选中团队、不关闭菜单。"
  },
  {
    id: "run-qa",
    memberSlug: "qa",
    time: "14:11",
    outcome: "failed-before-start",
    provenance: { kind: "planned" },
    cli: "Claude Code",
    model: "claude-sonnet-4.5",
    effort: "medium",
    summary: "这一步没跑起来：绑定的 Claude Code 进程启动失败（退出码 1）。"
  },
  {
    id: "run-security",
    memberSlug: "security",
    time: "昨天 18:40",
    outcome: "legacy",
    provenance: { kind: "bound" },
    cli: "Kimi",
    model: null,
    effort: null,
    summary: "升级前的历史记录：完成了依赖边界审查，未发现新增违规方向。"
  }
];

/* ------------------------------------------------------------------ */
/* 团队页保存反馈纯逻辑                                                */
/* ------------------------------------------------------------------ */

export interface SaveItemOutcome {
  slug: string;
  displayName: string;
  ok: boolean;
  error?: string;
}

export interface SaveSummary {
  savedAll: boolean;
  saved: SaveItemOutcome[];
  failed: SaveItemOutcome[];
}

export function summarizeSave(outcomes: SaveItemOutcome[]): SaveSummary {
  const saved = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  return { savedAll: failed.length === 0, saved, failed };
}

/** 「保存全部并离开」只在全部成功时导航；部分失败留在详情页。 */
export function shouldNavigateAfterSaveAll(summary: SaveSummary): boolean {
  return summary.savedAll && summary.saved.length > 0;
}
