import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  FollowingTeamDetailPage,
  type FollowingTeamDetailMember,
} from "@/console/github-team-pages";

const STATE_MATRIX = `
## 状态矩阵

| 页面 | 空态 | 加载中 | 报错 | 无权限 | 超长文本 |
| --- | --- | --- | --- | --- | --- |
| Agent 团队首页 | **AgentTeamsPage / 空态** | **加载中** | **加载失败** | 复用 **配置异常**：页面不可读取本机团队时保留框架与重试 | **文本边界** |
| 找现成团队 | **空结果** | **加载中并保留结构** | **GitHub 不可用** | **无权限** | **超长文本** |
| 安装前预览 | 复用 **仓库格式不符**：没有合法团队内容时禁止安装 | **加载中** | **GitHub 不可用**／**安装失败** | **无权限** | **超长 AGENT.md** |
| 持续接收更新团队详情 | **成员信息暂时无法读取** | **加载中** | **加载失败** | **来源仓库不可访问**：本地团队仍可编辑和使用 | **超长文本** |

每个单元格均指向当前 Storybook 中的具体 Story 或明确复用项；无空白。

### 次要页面一致性自查

- **找现成团队**：复用 Agent 团队首页的页面容器、标题、卡片、按钮与间距阶梯；窄窗语言过滤使用 PRD 指定的 Select，没有产生第二套筛选控件。
- **安装前预览**：正常、安装中、安装失败与长文本状态均复用只读 **AgentTeamDetail**；返回、标题、成员切换、Markdown 与操作层级继承既有详情页。
- **持续接收更新团队详情**：全部状态复用可编辑 **AgentTeamDetail**；同语义字段、成员选择、运行配置、头像选择、AGENT.md 与“保存”主操作只有一个组件变体。
- **一致性结论**：同类控件位置、按钮文案、对齐、间距、色值、字号与线性图标均来自既有生产组件；本步没有新增有意偏离。
`;

const DELIVERY_PACKAGE = `
## 交付六件套

### 1. 标注说明

- **浏览入口**：Page / Console / AgentTeamsPage、GithubTeamDiscoveryPage、GithubTeamPreviewPage、FollowingTeamDetailPage；全部为 fullscreen Page Story，并使用确定 fixture。
- **结构复用**：四页共用 **AgentTeamsPageSurface** 的 960px 内容列、页面内边距与滚动归属；列表型子页共用 **AgentTeamsPageHeading**，预览与跟随详情分别复用只读、可编辑的 **AgentTeamDetail**。
- **视觉令牌**：颜色只使用 canvas、card、sunken、line、ink、sub、hint、accent、danger 等语义令牌；UI 字号限定为 11／12／13／15／18px，字重限定为 400／600。
- **形态与图标**：卡片、内嵌面和控件分别沿用 12／8／6px 圆角层级；图标统一来自 Lucide，普通图标 16px、紧凑图标 14px，线宽 1.5。
- **操作层级**：安装前预览只有“安装”一个主操作，持续接收更新团队详情只有“保存”一个主操作；返回、打开仓库、重试、停止接收更新、撤销、更多操作使用 outline／ghost 或文本链接层级。
- **响应式**：390px 下发现页语言过滤改用 Select；结果元信息纵向换行；成员条保持单行横向滚动；安装区固定在视口底部，页面不产生横向溢出。
- **集成边界**：Story 只表达搜索、打开仓库、安装、同步、保存和导航意图，不访问 GitHub、gh 登录态、IPC、磁盘或用户数据。

### 2. 与 PRD 差异清单终稿

1. **【呈现层】找现成团队／结果区**：PRD 字符图把结果画在一块带分隔线的列表内；设计稿改为沿用 Agent 团队首页的独立卡片行。理由：复用已确立的团队浏览结构，同时让整卡预览与仓库外链保持两个独立命中目标。
2. **【呈现层】安装前预览／身份与成员内容**：PRD 字符图使用专属摘要区；设计稿将仓库、star、更新时间和语言并入共享详情页头，将主 Agent、成员总数与阅读说明放在共享成员区之前。理由：完整复用只读 AgentTeamDetail，避免同一团队详情产生第二套结构；信息项未增删。

### 3. 建议回退 PRD 的问题清单

无。当前页面在不增删信息项、不改变字段含义、不合并拆分功能的前提下可以成立。

### 4. 有意偏离清单汇总

无。两项 PRD 差异均属于允许调整的呈现层，并可追溯到已定稿的 DESIGN 规范、Agent 团队页面结构和 PRD 响应式要求；没有偏离强基准或本项目既有组件模式。

### 5. 遗留事项终稿

- 未采纳的评审提醒：无。
- “无本项目依据，仅为竞品惯例”的模式条目：无；风格风险已判定为无。
- 待核实事实：无。

### 6. 对账清单

- **信息项落位**：Agent 团队首页的「找现成团队／新建团队」常驻入口、新建菜单两条路径、「持续接收更新／独立维护」分组与来源仓库身份已落位。
- **信息项落位**：发现页的搜索、语言、登录范围、名称、用途、仓库、star、更新时间、语言与私有标记已落位。
- **信息项落位**：预览页的仓库身份、主 Agent、成员总数、逐名推荐配置、完整 AGENT.md、三项安装后果及安装状态已落位。
- **信息项落位**：持续接收更新团队详情的来源仓库、自定义状态、同步结果、来源失效、成员、运行配置、AGENT.md、管理操作与单一保存已落位。
- **状态矩阵**：4 个页面 × 空态／加载中／报错／无权限／超长文本全部有 Story 或明确复用项，无空白。
- **一致性**：同类控件、按钮文案、对齐、间距、色值、字号、图标、圆角和主操作权重均已逐项检查；无未登记差异。
- **Storybook 边界**：Component／Block／Page 分类、fullscreen Page Story、确定 fixture 与无运行时副作用约束均满足。
`;

const members: FollowingTeamDetailMember[] = [
  {
    slug: "dev-manager",
    displayName: "开发经理",
    description: "拆分任务并组织交付接力",
    recommendedProfile: "gpt-5.6-sol · high",
    executionProfile: "Kimi · kimi-for-coding · on",
    profileSource: "overridden",
    markdown: "# 开发经理\n\n负责技术决策、任务拆分与交付收口。\n\n## 交付规则\n\n交付汇总以真机行为证据开头，随后列出实现范围、验证结果与遗留风险。",
  },
  {
    slug: "dev",
    displayName: "开发",
    description: "按方案实现并验证改动",
    recommendedProfile: "claude-opus-5 · high",
    executionProfile: "Claude Code · opus · high",
    profileSource: "recommended",
    markdown: "# 开发\n\n按已确认方案实现功能，保留既有边界并运行受影响测试。",
  },
  {
    slug: "qa",
    displayName: "测试",
    description: "对抗性检查交付结果",
    recommendedProfile: "gpt-5.6-sol · high",
    executionProfile: "Codex · gpt-5.6-sol · high",
    profileSource: "recommended",
    markdown: "# 测试\n\n逐项检查主流程、边界状态与真实应用行为。",
  },
  {
    slug: "release",
    displayName: "发布",
    description: "核对制品与发布记录",
    recommendedProfile: "kimi-k2 · medium",
    executionProfile: "Kimi · kimi-k2 · medium",
    profileSource: "recommended",
    markdown: "# 发布\n\n核对版本、制品签名、哈希与发布记录。",
  },
];

function DetailHarness(): JSX.Element {
  const [selectedMemberSlug, setSelectedMemberSlug] = useState("dev-manager");
  return (
    <FollowingTeamDetailPage
      name="开发团队"
      description="负责软件方案、实现、测试、复核和主理收尾。"
      repository="tranfu-labs/moebius-team-development"
      customized
      primaryAgentSlug="dev-manager"
      members={members}
      selectedMemberSlug={selectedMemberSlug}
      syncSummary={{
        commit: "a3450d6",
        affectedMemberCount: 3,
        summary: "新增 release，移除旧 qa 职责，dev 的交付规则有更新。",
      }}
      onSelectMember={setSelectedMemberSlug}
    />
  );
}

const meta = {
  title: "Page/Console/FollowingTeamDetailPage",
  component: FollowingTeamDetailPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: `${STATE_MATRIX}\n${DELIVERY_PACKAGE}` } },
  },
  decorators: [(Story) => <div className="h-screen"><Story /></div>],
  globals: { theme: "dark" },
  args: {
    name: "开发团队",
    description: "负责软件方案、实现、测试、复核和主理收尾。",
    repository: "tranfu-labs/moebius-team-development",
    customized: true,
    primaryAgentSlug: "dev-manager",
    members,
    selectedMemberSlug: "dev-manager",
    syncSummary: {
      commit: "a3450d6",
      affectedMemberCount: 3,
      summary: "新增 release，移除旧 qa 职责，dev 的交付规则有更新。",
    },
  },
} satisfies Meta<typeof FollowingTeamDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SyncedUpstream: Story = {
  name: "持续接收更新 · 刚完成同步",
  render: () => <DetailHarness />,
};

export const EmptyMembers: Story = {
  name: "成员信息暂时无法读取",
  args: { members: [], selectedMemberSlug: undefined, syncSummary: null },
};

export const Loading: Story = {
  name: "加载中",
  args: { contentState: "loading", syncSummary: null },
};

export const LoadFailed: Story = {
  name: "加载失败",
  args: { contentState: "error", syncSummary: null, onRetryLoad: () => undefined },
};

export const UpstreamUnavailable: Story = {
  name: "来源仓库不可访问",
  args: {
    upstreamStatus: "unavailable",
    syncSummary: null,
    onRetryUpstream: () => undefined,
    onDetachUpstream: () => undefined,
  },
};

export const LongText: Story = {
  name: "超长文本",
  args: {
    name: "负责跨平台桌面应用架构、实现、质量复核与长期维护的开发协作团队",
    repository: "a-very-long-organization-name/moebius-team-desktop-development-and-release-governance",
    description: "覆盖需求拆解、架构决策、实现、自动化测试、真实应用验收、签名公证、发布核对与后续故障处置，并保留每一步的证据。",
    members: members.map((member, index) => index === 0 ? {
      ...member,
      markdown: `${member.markdown}\n\n${Array.from({ length: 18 }, (_, item) => `## 长文规则 ${item + 1}\n\n用于验证正文区域在长内容下保持可读，页面操作不会与正文发生覆盖。`).join("\n\n")}`,
    } : member),
  },
};
