import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  GithubTeamDiscoveryPage,
  type GithubTeamDiscoveryState,
  type GithubTeamLanguage,
  type GithubTeamSearchResult,
} from "@/console/github-team-pages";

const results: GithubTeamSearchResult[] = [
  {
    repository: "someone/moebius-team-product",
    name: "产品团队",
    description: "从需求澄清到 PRD 定稿，四名成员接力。",
    stars: 128,
    updatedLabel: "3 天前更新",
    language: "zh",
  },
  {
    repository: "mycorp/moebius-team-growth",
    name: "增长团队",
    description: "投放素材、落地页与数据复盘。",
    stars: 12,
    updatedLabel: "上周更新",
    language: "en",
    private: true,
  },
];

function DiscoveryHarness({
  initialQuery = "产品",
  initialLanguage = "zh",
  ghAuthenticated = true,
  state = { status: "ready", results },
}: {
  initialQuery?: string;
  initialLanguage?: GithubTeamLanguage;
  ghAuthenticated?: boolean;
  state?: GithubTeamDiscoveryState;
}): JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [language, setLanguage] = useState(initialLanguage);
  return (
    <GithubTeamDiscoveryPage
      query={query}
      language={language}
      ghAuthenticated={ghAuthenticated}
      state={state}
      onQueryChange={setQuery}
      onLanguageChange={setLanguage}
    />
  );
}

const meta = {
  title: "Page/Console/GithubTeamDiscoveryPage",
  component: GithubTeamDiscoveryPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="h-screen"><Story /></div>],
  globals: { theme: "dark" },
  args: {
    query: "产品",
    language: "zh",
    ghAuthenticated: true,
    state: { status: "ready", results },
  },
} satisfies Meta<typeof GithubTeamDiscoveryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = { name: "搜索结果" };

export const Interactive: Story = {
  name: "可交互筛选",
  render: () => <DiscoveryHarness />,
};

export const Initial: Story = {
  name: "中性初始",
  render: () => <DiscoveryHarness initialQuery="" state={{ status: "initial" }} />,
};

export const Loading: Story = {
  name: "加载中并保留结构",
  args: { state: { status: "loading", previousResults: results } },
};

export const Empty: Story = {
  name: "空结果",
  args: { query: "报表", language: "all", state: { status: "empty" } },
};

export const RateLimited: Story = {
  name: "限流 · 未登录 gh",
  args: { ghAuthenticated: false, state: { status: "rate-limited", seconds: 42 } },
};

export const Offline: Story = {
  name: "GitHub 不可用",
  args: { state: { status: "offline" } },
};

export const PermissionDenied: Story = {
  name: "无权限",
  args: { state: { status: "permission-denied" } },
};

export const LongText: Story = {
  name: "超长文本",
  args: {
    state: {
      status: "ready",
      results: [{
        ...results[0]!,
        repository: "a-very-long-organization-name/moebius-team-product-research-and-continuous-delivery",
        name: "跨境企业级产品研究、合规审查与持续交付协作团队",
        description: "覆盖多个国家与地区的需求澄清、用户研究、隐私合规、交付验收与长期维护，并保留完整决策证据。",
      }],
    },
  },
};

export const Narrow: Story = {
  name: "窄窗",
  parameters: {
    viewport: {
      defaultViewport: "githubTeamsNarrow",
      viewports: { githubTeamsNarrow: { name: "390 × 780", styles: { width: "390px", height: "780px" } } },
    },
  },
};
