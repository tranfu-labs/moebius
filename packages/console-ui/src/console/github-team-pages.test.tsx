import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FollowingTeamDetailPage, GithubTeamDiscoveryPage } from "./github-team-pages";

describe("GithubTeamDiscoveryPage product language", () => {
  it("uses the same visible discovery task name as the Agent teams entry", () => {
    render(
      <GithubTeamDiscoveryPage
        query=""
        language="zh"
        ghAuthenticated={false}
        state={{ status: "initial" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "找现成团队" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "搜索团队名称或用途" })).toBeVisible();
    expect(screen.getByText("输入团队名称或用途")).toBeVisible();
    expect(screen.getByText("看看有没有适合你的现成团队。")).toBeVisible();
    expect(screen.getByText(/登录本机 GitHub 后/u)).toBeVisible();
  });

  it("distinguishes a successful empty search from GitHub failures", () => {
    render(
      <GithubTeamDiscoveryPage
        query="报表"
        language="all"
        ghAuthenticated
        state={{ status: "empty" }}
      />,
    );

    expect(screen.getByText("没有找到匹配的团队")).toBeVisible();
    expect(screen.getByText("换个关键词或语言，再试一次。")).toBeVisible();
    expect(screen.queryByText(/连不上 GitHub/u)).not.toBeInTheDocument();
  });
});

describe("FollowingTeamDetailPage update relationship", () => {
  it("keeps the team usable and names the action by its consequence", () => {
    const onDetachUpstream = vi.fn();
    render(
      <FollowingTeamDetailPage
        name="开发团队"
        description="负责软件交付"
        repository="tranfu-labs/moebius-team-development"
        primaryAgentSlug="dev"
        members={[{
          slug: "dev",
          displayName: "开发",
          description: "实现并验证改动",
          recommendedProfile: "gpt-5.6-sol · high",
          executionProfile: "Codex · gpt-5.6-sol · high",
          profileSource: "recommended",
          markdown: "# 开发",
        }]}
        upstreamStatus="unavailable"
        syncSummary={null}
        onDetachUpstream={onDetachUpstream}
      />,
    );

    expect(screen.getByText("这支团队照常能用，只是不再接收作者更新")).toBeVisible();
    expect(screen.getByRole("button", { name: "来源仓库 tranfu-labs/moebius-team-development" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "停止接收更新" }));
    expect(onDetachUpstream).toHaveBeenCalledOnce();
  });
});
